import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { launchBrowser } from './browser.ts';
import { blockers, paperSizes, type Worksheet, type Block } from './schema.ts';
import { project, type PublicSheet, type PublicBlock } from './projection.ts';
import { atomicJson, fingerprint, loadTask, withLock } from './model.ts';
import { FONT_SHA256 } from './setup-font.ts';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export interface LayoutReport { pages: number; questions: number; questionPages: Record<string, number[]>; fontPt: number; paperSize: 'A3' | 'A4'; pretextMeasurements: number; warnings: string[] }
export interface GenerateOptions { task: string; mode?: 'preview' | 'export'; answers?: boolean; draft?: boolean }
export interface Artifact { html: string; pdf?: string; thumbnails: string[]; layout: LayoutReport; pdfCheck?: { pages: number; widthPt: number; heightPt: number }; durationMs: number }
export interface Generation { id: string; pid?: number; revision: number; fingerprint: string; paperSize: string; status: 'generating' | 'success' | 'failed' | 'stale'; mode: string; directory: string; draft: boolean; student?: Artifact; answers?: Artifact; error?: string; stateWarning?: string; durationMs?: number; exclusions: string[]; blockers: string[]; browserVersion?: string; pageChanges?: Record<string, { before: number[]; after: number[] }>; pageCountChange?: number }
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export async function localResource(directory: string, asset: string): Promise<Buffer> {
  if (!asset || asset.includes('\0') || /^(?:[a-z]+:|[\\/])/i.test(asset)) throw new Error('题图必须引用任务目录内的相对资源');
  const base = await realpath(directory); const target = await realpath(resolve(base, asset)).catch(() => { throw new Error(`资源缺失：${asset}，请重新关联图片后重试`); });
  const rel = relative(base, target);
  if (rel.startsWith('..') || rel.startsWith('/')) throw new Error('题图资源越出任务目录');
  if (!/\.(png|jpe?g|webp)$/i.test(extname(asset))) throw new Error('题图只允许 PNG、JPEG、WebP');
  return readFile(target);
}
async function embedImages(sheet: PublicSheet, directory: string): Promise<void> {
  const cache = new Map<string, string>();
  async function walk(bs: PublicBlock[]) {
    for (const b of bs) {
      if (b.type === 'subquestion') await walk(b.blocks);
      if (b.type !== 'image') continue;
      let embedded = cache.get(b.asset);
      if (!embedded) {
        const bytes = await localResource(directory, b.asset); const meta = await sharp(bytes).metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new Error(`无法读取题图 ${b.asset}`);
        // Normalize orientation and remove photo metadata before delivery.
        embedded = `data:image/png;base64,${(await sharp(bytes).rotate().png().toBuffer()).toString('base64')}`; cache.set(b.asset, embedded);
      }
      b.asset = embedded;
    }
  }
  for (const q of sheet.questions) await walk(q.blocks);
}
let shared: Promise<{ css: string; js: string; licenses: string }> | undefined;
async function resources() {
  shared ??= (async () => {
    const [font, css, katexRaw, bundle, ...licenses] = await Promise.all([
      readFile(join(skillRoot, 'assets/fonts/NotoSansSC.woff2')),
      readFile(join(skillRoot, 'assets/print.css'), 'utf8'),
      readFile(join(skillRoot, 'node_modules/katex/dist/katex.min.css'), 'utf8'),
      build({ entryPoints: [join(skillRoot, 'assets/worksheet.ts')], bundle: true, minify: true, write: false, platform: 'browser', format: 'iife', legalComments: 'inline' }),
      readFile(join(skillRoot, 'assets/fonts/OFL.txt'), 'utf8'), readFile(join(skillRoot, 'LICENSE'), 'utf8'),
      readFile(join(skillRoot, 'node_modules/katex/LICENSE'), 'utf8'), readFile(join(skillRoot, 'node_modules/@chenglou/pretext/LICENSE'), 'utf8')
    ]);
    if (createHash('sha256').update(font).digest('hex') !== FONT_SHA256) throw new Error('固定中文字体校验失败，请从完整 skill 包恢复 assets/fonts/NotoSansSC.woff2');
    const paths = [...new Set([...katexRaw.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]))];
    let katexCss = katexRaw;
    for (const p of paths) {
      const bytes = await readFile(join(skillRoot, 'node_modules/katex/dist', p));
      const mime = p.endsWith('.woff2') ? 'font/woff2' : p.endsWith('.woff') ? 'font/woff' : 'font/ttf';
      katexCss = katexCss.split(`url(${p})`).join(`url(data:${mime};base64,${bytes.toString('base64')})`);
    }
    return { css: `@font-face{font-family:"Workbook Sans";src:url(data:font/woff2;base64,${font.toString('base64')}) format("woff2");font-weight:100 900;font-display:block}\n${katexCss}\n${css}`, js: bundle.outputFiles[0].text, licenses: licenses.join('\n\n') };
  })();
  try { return await shared; } catch (e) { shared = undefined; throw e; }
}
export async function renderHtml(sheet: PublicSheet): Promise<string> {
  const { css, js, licenses } = await resources();
  const [width, height] = paperSizes[sheet.layout.paperSize];
  const gap = sheet.layout.preset === 'compact' ? 3 : sheet.layout.preset === 'spacious' ? 7 : 5;
  const json = JSON.stringify(sheet).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'"><title>${escapeHtml(sheet.title)} · ${sheet.layout.paperSize} · r${sheet.revision}</title><style>${css}\n@page{size:${width}mm ${height}mm;margin:0}:root{--paper-width:${width}mm;--paper-height:${height}mm;--margin:${sheet.layout.marginMm}mm;--font:${sheet.layout.fontPt}pt;--cell:${sheet.layout.cellMm}mm;--gap:${gap}mm}</style></head><body>
<aside class="sidebar"><div class="brand"><span class="brand-text">▤ 错题打印助手</span><button id="collapse" aria-label="折叠或展开页面导航" aria-expanded="true">☰</button></div><nav aria-label="预览页面"><p class="nav-label">全部页面</p><div class="page-nav"></div></nav><div class="sidebar-note">${sheet.layout.paperSize} · ${sheet.kind === 'student' ? '学生练习' : '独立答案册'}<br>打印选择 ${sheet.layout.paperSize} 纸张<br>实际大小 / 100%</div></aside>
<main><div class="topbar"><h1>${escapeHtml(sheet.title)}</h1><div class="actions"><label for="zoom">缩放</label><select id="zoom"><option value="0">适合宽度</option><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select><button id="print" class="primary" disabled>打印预览</button></div></div><p class="status" role="status" aria-live="polite">正在加载字体并排版…</p><p class="warnings"></p><div class="preview"><div class="pages"></div></div></main>
<script type="application/json" id="sheet-data">${json}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script><!-- Third-party licenses\n${licenses.replace(/--/g, '—')} --></body></html>`;
}
export async function inspectLayout(browser: Browser, htmlPath: string, pdfPath: string | undefined, directory: string, prefix: string, expected: PublicSheet): Promise<Artifact> {
  const started = performance.now(); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error, undefined, { timeout: 60000 });
    const error = await page.evaluate(() => document.documentElement.dataset.error); if (error) throw new Error(error);
    await page.emulateMedia({ media: 'print' });
    const issues = await page.evaluate(() => {
      const issues: string[] = [];
      for (const [index, paper] of Array.from(document.querySelectorAll<HTMLElement>('.paper')).entries()) {
        const body = paper.querySelector<HTMLElement>('.sheet-body')!; const rect = body.getBoundingClientRect();
        if (!body.querySelector('.question')) issues.push(`第 ${index + 1} 页为空`);
        if (body.scrollHeight > body.clientHeight + 1) issues.push(`第 ${index + 1} 页高度溢出`);
        for (const heading of body.querySelectorAll<HTMLElement>('.section-heading')) {
          const firstQuestion = heading.nextElementSibling?.querySelector<HTMLElement>('.question');
          if (!firstQuestion || firstQuestion.dataset.sectionId !== heading.dataset.sectionId) issues.push(`第 ${index + 1} 页题型标题与题目分离`);
        }
        for (const q of body.querySelectorAll<HTMLElement>('.question')) {
          const box = q.getBoundingClientRect();
          if (box.bottom > rect.bottom + 1 || box.top < rect.top - 1 || box.right > rect.right + 1 || box.left < rect.left - 1 || q.scrollWidth > q.clientWidth + 1) issues.push(`第 ${index + 1} 页题 ${q.dataset.number} 越界`);
        }
      }
      if (Array.from(document.images).some(i => !i.complete || !i.naturalWidth)) issues.push('必要题图未加载');
      return issues;
    });
    if (issues.length) throw new Error(issues.join('；'));
    const layout = await page.evaluate(() => (window as any).__worksheetReport as LayoutReport);
    if (layout.questions !== expected.questions.length || JSON.stringify(Object.keys(layout.questionPages)) !== JSON.stringify(expected.questions.map(q => q.id))) throw new Error('输出题目数量或顺序对账失败');
    const thumbnails: string[] = [];
    for (let i = 0; i < layout.pages; i++) {
      const file = `${prefix}-page-${String(i + 1).padStart(3, '0')}.png`;
      const full = await page.locator('.paper').nth(i).screenshot({ scale: 'css' });
      await sharp(full).resize({ width: 650 }).png().toFile(join(directory, file)); thumbnails.push(file);
    }
    let pdfCheck: Artifact['pdfCheck'];
    if (pdfPath) {
      await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true });
      const pdf = await PDFDocument.load(await readFile(pdfPath)); const [w, h] = paperSizes[expected.layout.paperSize].map(n => n * 72 / 25.4);
      if (pdf.getPageCount() !== layout.pages) throw new Error(`PDF ${pdf.getPageCount()} 页与预览 ${layout.pages} 页不符`);
      for (const p of pdf.getPages()) if (Math.abs(p.getWidth() - w) > 1 || Math.abs(p.getHeight() - h) > 1) throw new Error('PDF 纸张尺寸不符');
      pdfCheck = { pages: pdf.getPageCount(), widthPt: pdf.getPage(0).getWidth(), heightPt: pdf.getPage(0).getHeight() };
    }
    return { html: htmlPath, pdf: pdfPath, thumbnails, layout, pdfCheck, durationMs: Math.round(performance.now() - started) };
  } catch (e) { if (pdfPath) await rm(pdfPath, { force: true }); throw e; }
  finally { await page.close(); }
}
export async function generate(options: GenerateOptions): Promise<Generation> {
  const started = performance.now(); const taskDir = resolve(options.task); const w = await loadTask(taskDir); const problems = blockers(w);
  const mode = options.mode || 'export';
  if (mode === 'export' && (options.draft || problems.length)) throw new Error(`正式导出被阻止：${problems.join('；') || '草稿模式不能导出 PDF'}`);
  if (!w.questions.some(q => q.selected)) throw new Error('没有入选题目');
  if (mode === 'preview' && problems.length && !options.draft) throw new Error(`存在未决内容，请先处理，或使用 --draft 生成带标注草稿：${problems.join('；')}`);
  const id = `r${String(w.revision).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
  const directory = join(taskDir, 'exports', id); await mkdir(directory, { recursive: true });
  const result: Generation = { id, pid: process.pid, revision: w.revision, fingerprint: fingerprint(w), paperSize: w.layout.paperSize, status: 'generating', mode, directory, draft: !!options.draft, exclusions: w.questions.filter(q => !q.selected).map(q => q.id), blockers: problems };
  const reportPath = join(directory, 'report.json'); await atomicJson(reportPath, result);
  let browser: Browser | undefined;
  try {
    await withLock(taskDir, async () => { if (fingerprint(await loadTask(taskDir)) !== result.fingerprint) throw new Error('任务已修改，请重新生成'); await atomicJson(join(taskDir, 'generation.json'), result); });
    const student = project(w, 'student', !!options.draft); await embedImages(student, taskDir);
    if (options.draft) student.warnings.push(...problems);
    const filename = `${w.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 70)}-${w.layout.paperSize}-${w.date}-r${w.revision}`;
    const htmlPath = join(directory, `${filename}-学生卷.html`); await writeFile(htmlPath, await renderHtml(student));
    browser = await launchBrowser(); result.browserVersion = browser.version();
    result.student = await inspectLayout(browser, htmlPath, mode === 'export' ? join(directory, `${filename}-学生卷.pdf`) : undefined, directory, 'student', student);
    if (options.answers) {
      if (options.draft) throw new Error('草稿不能生成答案册');
      const answerSheet = project(w, 'answers'); const answerHtml = join(directory, `${filename}-答案册.html`); await writeFile(answerHtml, await renderHtml(answerSheet));
      result.answers = await inspectLayout(browser, answerHtml, mode === 'export' ? join(directory, `${filename}-答案册.pdf`) : undefined, directory, 'answers', answerSheet);
    }
    result.status = 'success'; result.durationMs = Math.round(performance.now() - started);
    try {
      const previous = JSON.parse(await readFile(join(taskDir, 'latest.json'), 'utf8')) as Generation;
      if (previous.student) {
        result.pageCountChange = result.student.layout.pages - previous.student.layout.pages;
        result.pageChanges = Object.fromEntries(Object.entries(result.student.layout.questionPages).filter(([qid, pages]) => JSON.stringify(previous.student?.layout.questionPages[qid]) !== JSON.stringify(pages)).map(([qid, pages]) => [qid, { before: previous.student!.layout.questionPages[qid] || [], after: pages }]));
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await withLock(taskDir, async () => {
      const latest = await loadTask(taskDir);
      const attempt = JSON.parse(await readFile(join(taskDir, 'generation.json'), 'utf8'));
      if (fingerprint(latest) !== result.fingerprint || attempt.id !== result.id) {
        result.status = 'stale'; result.error = '任务已修改或已有更新生成请求，此结果为旧版本，不能作为当前下载文件';
        if (attempt.id === result.id) await atomicJson(join(taskDir, 'generation.json'), result);
      }
      else {
        await atomicJson(join(taskDir, 'task.json'), { ...latest, stage: mode === 'export' ? 'export' : 'preview' });
        await atomicJson(join(taskDir, 'latest.json'), result); await atomicJson(join(taskDir, 'generation.json'), result);
      }
      await atomicJson(reportPath, result);
    });
    return result;
  } catch (e) {
    result.status = 'failed'; result.error = (e as Error).message; result.durationMs = Math.round(performance.now() - started);
    // Never advertise a partially successful PDF set as a successful export.
    for (const artifact of [result.student, result.answers]) if (artifact?.pdf) { await rm(artifact.pdf, { force: true }); artifact.pdf = undefined; }
    await atomicJson(reportPath, result);
    try {
      await withLock(taskDir, async () => {
        let attempt;
        try { attempt = JSON.parse(await readFile(join(taskDir, 'generation.json'), 'utf8')); } catch (readError) { if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError; }
        if (attempt?.id === result.id) await atomicJson(join(taskDir, 'generation.json'), result);
      });
    } catch (stateError) { result.stateWarning = `状态登记未更新：${(stateError as Error).message}`; await atomicJson(reportPath, result); }
    throw new Error(`${result.error}\n任务保留在 ${taskDir}，本次失败报告：${reportPath}`, { cause: e });
  } finally { await browser?.close(); }
}
