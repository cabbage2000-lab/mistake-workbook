import { parseArgs } from 'node:util';
import { readFile, access, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTask, currentExport, loadTask, newTask, summary, updateTask } from './model.ts';
import { generate, localResource } from './generate.ts';
import { blockers, images, inferPaper, parseWorksheet } from './schema.ts';
import { importImage } from './sources.ts';
import { launchBrowser } from './browser.ts';

const help = `错题打印助手（由宿主调用，家长无需运行命令）
  doctor --task <可写目录>             检查 Node、字体、写入和浏览器/PDF 能力
  init --task <目录> --input <JSON>    导入已结构化任务；或 --title <标题> --request <原始要求> [--paper A3|A4]
  status --task <目录>                读取保存任务、来源覆盖、疑点与当前文件版本
  apply --task <目录> --input <补丁>  原子应用 expectedRevision + operations
  import-image --task <目录> --file <照片> --id S1 [--rotate 90] [--crop x,y,w,h]
  validate --task <目录>              校验内容、疑点、来源与必要题图
  preview --task <目录> [--draft]     生成 HTML 与所有页面缩略图
  export --task <目录> [--answers]    生成同修订预览与正式 PDF
  generate --task <目录> [--answers]  export 的别名
  --paper A3|A4                      init 时的明确纸型；切换纸型通过 apply layout 操作
每次生成使用独立目录。status 的 stale:true 表示旧文件，禁止当作最新结果交付。`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    task: { type: 'string' }, input: { type: 'string' }, title: { type: 'string' }, request: { type: 'string' }, paper: { type: 'string' },
    file: { type: 'string' }, id: { type: 'string' }, rotate: { type: 'string' }, crop: { type: 'string' },
    answers: { type: 'boolean' }, draft: { type: 'boolean' }, help: { type: 'boolean' }
  } });
  if (values.help || !positionals.length) { console.log(help); return; }
  if (!values.task) throw new Error('缺少 --task <任务目录>');
  const directory = resolve(values.task); const command = positionals[0];
  if (positionals.length !== 1) throw new Error('只接受一个子命令');
  if (values.paper && !['A3', 'A4'].includes(values.paper)) throw new Error('--paper 只能为 A3 或 A4');
  let result: unknown;
  switch (command) {
    case 'doctor': {
      const checks: Record<string, unknown> = { node: process.version, hostVision: '需宿主实际读取附件验证；脚本不提供 OCR' };
      await mkdir(directory, { recursive: true }); const probe = join(directory, `.write-probe-${process.pid}`);
      try { await writeFile(probe, 'probe', { flag: 'wx' }); checks.writable = true; } finally { await rm(probe, { force: true }); }
      await access(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assets/fonts/NotoSansSC.woff2')); checks.font = 'bundled';
      const browser = await launchBrowser();
      try { const page = await browser.newPage(); await page.setContent('<p>PDF check</p>'); const bytes = await page.pdf(); checks.pdf = bytes.length > 0; checks.browser = browser.version(); } finally { await browser.close(); }
      result = checks; break;
    }
    case 'init': {
      let input;
      if (values.input) {
        input = JSON.parse(await readFile(resolve(values.input), 'utf8'));
        if (!input.layout?.paperSize) input.layout = { ...input.layout, ...inferPaper(input.request || '', values.paper as 'A3' | 'A4' | undefined) };
        else if (values.paper) input.layout = { ...input.layout, ...inferPaper('', values.paper as 'A3' | 'A4') };
      } else { if (!values.title) throw new Error('需要 --input 或 --title'); input = newTask(values.title, values.request, values.paper as 'A3' | 'A4' | undefined); }
      const w = await createTask(directory, input); result = { saved: join(directory, 'task.json'), ...summary(w) }; break;
    }
    case 'status': result = { saved: join(directory, 'task.json'), ...summary(await loadTask(directory)), latest: await currentExport(directory) }; break;
    case 'apply': {
      if (!values.input) throw new Error('缺少 --input 补丁文件');
      const w = await updateTask(directory, JSON.parse(await readFile(resolve(values.input), 'utf8'))); result = { saved: join(directory, 'task.json'), ...summary(w), latest: await currentExport(directory) }; break;
    }
    case 'import-image': {
      if (!values.file || !values.id) throw new Error('缺少 --file 或 --id');
      const crop = values.crop?.split(',').map(Number);
      if (crop && (crop.length !== 4 || crop.some(n => !Number.isInteger(n) || n < 0) || !crop[2] || !crop[3])) throw new Error('--crop 需要非负整数 x,y 与正整数 w,h');
      const rotate = values.rotate === undefined ? undefined : Number(values.rotate);
      if (rotate !== undefined && ![0, 90, 180, 270].includes(rotate)) throw new Error('--rotate 只能为 0/90/180/270');
      result = await importImage(directory, values.file, { id: values.id, rotate, crop: crop as [number, number, number, number] | undefined }); break;
    }
    case 'validate': {
      const w = parseWorksheet(await loadTask(directory)); const problems = blockers(w);
      for (const q of w.questions.filter(q => q.selected)) for (const image of images(q.blocks)) { try { await localResource(directory, image.asset); } catch (e) { problems.push(`${q.id}: ${(e as Error).message}`); } }
      result = { valid: true, exportable: !problems.length, problems, ...summary(w) }; if (problems.length) process.exitCode = 2; break;
    }
    case 'preview': case 'export': case 'generate': result = await generate({ task: directory, mode: command === 'preview' ? 'preview' : 'export', answers: values.answers, draft: values.draft }); break;
    default: throw new Error(`未知子命令：${command}\n${help}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ status: 'failed', error: error.message })); process.exitCode = 1; });
