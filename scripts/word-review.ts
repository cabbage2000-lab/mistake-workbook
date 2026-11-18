import { execFile } from 'node:child_process';
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { LayoutReview } from '../assets/layout-review.ts';
import type { PublicBlock, PublicSheet } from './projection.ts';
import { paperSizes } from './schema.ts';

const run = promisify(execFile);
const inspector = fileURLToPath(new URL('./inspect-word-pages.py', import.meta.url));
const pythonExecutable = () => process.env.MISTAKE_WORKBOOK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

interface WordPages {
  pages: number;
  thumbnails: string[];
  questionNumbers: number[][];
  findings: { page: number; reason: string }[];
}
export interface WordReview {
  status: 'structure-only' | 'unavailable' | 'rendered' | 'needs-review';
  reasons: string[]; detail?: string; renderer?: string; actual?: WordPages;
}

async function officeExecutable() {
  const command = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
  const paths = process.env.MISTAKE_WORKBOOK_SOFFICE ? [process.env.MISTAKE_WORKBOOK_SOFFICE] : [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ...(process.env.ProgramFiles ? [join(process.env.ProgramFiles, 'LibreOffice', 'program', command)] : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, command)),
  ];
  for (const path of paths) {
    try { await access(path, constants.X_OK); return resolve(path); } catch { /* Try the next installed location. */ }
  }
}

export async function wordReviewEnvironment() {
  const office = await officeExecutable();
  const python = pythonExecutable();
  if (!office) return { available: false, detail: '未找到 LibreOffice' };
  try {
    await run(python, ['-c', 'import pymupdf'], { timeout: 10000 });
    return { available: true, office, python };
  } catch { return { available: false, office, python, detail: 'Python 或 PyMuPDF 不可用' }; }
}

function hasMaterial(blocks: PublicBlock[]): boolean {
  return blocks.some(b => b.type === 'image' || b.type === 'table' || b.type === 'formula' ||
    (b.type === 'text' && (b.text.length >= 400 || b.text.includes('\\('))) ||
    (b.type === 'subquestion' && hasMaterial(b.blocks)));
}

export async function reviewWord(path: string, prefix: string, sheet: PublicSheet, layout: LayoutReview): Promise<WordReview> {
  const reasons: string[] = [];
  if (sheet.sections.length > 1) reasons.push('混合题型');
  if (sheet.questions.some(q => q.type === 'reading' || hasMaterial(q.blocks))) reasons.push('阅读、长材料、图表或公式');
  if (layout.initial.length) reasons.push('首次排版触发了复核');
  if (layout.pages.reduce((n, p) => n + p.questions.length, 0) > sheet.questions.length) reasons.push('单题跨页');
  if (sheet.layout.maxPages) reasons.push('指定页数上限');
  if (!reasons.length) return { status: 'structure-only', reasons };
  const soffice = await officeExecutable();
  if (!soffice) return { status: 'unavailable', reasons, detail: '未找到 LibreOffice，可设置 MISTAKE_WORKBOOK_SOFFICE。实际 Word 分页待核对。' };
  const python = pythonExecutable();
  const scratch = await mkdtemp(join(tmpdir(), 'workbook-word-'));
  let actual: WordPages;
  try {
    await run(soffice, [`-env:UserInstallation=${pathToFileURL(join(scratch, 'profile')).href}`, '--headless',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', scratch, path], { timeout: 90000 });
    const pdf = join(scratch, basename(path, '.docx') + '.pdf');
    const { stdout } = await run(python, [inspector, pdf, scratch, prefix, ...paperSizes[sheet.layout.paperSize].map(String),
      String(sheet.layout.marginMm)], { timeout: 60000 });
    actual = JSON.parse(stdout) as WordPages;
    if (!sheet.layout.maxPages || actual.pages <= sheet.layout.maxPages) {
      for (const file of actual.thumbnails) await copyFile(join(scratch, file), join(dirname(path), file));
    }
  } catch (cause) {
    const error = cause as Error & { stderr?: string };
    const detail = (error.stderr || error.message).trim().split('\n').at(-1);
    return { status: 'unavailable', reasons, detail: `Word 页面未完成渲染或读取（${detail}）。请核对 LibreOffice 和 Python 的 PyMuPDF 安装。` };
  } finally { await rm(scratch, { recursive: true, force: true }); }

  if (sheet.layout.maxPages && actual.pages > sheet.layout.maxPages) throw new Error(`Word 实际排版需要 ${actual.pages} 页，超过限制 ${sheet.layout.maxPages} 页`);
  if (actual.pages !== layout.pages.length) actual.findings.push({ page: actual.pages, reason: `Word 渲染为 ${actual.pages} 页，浏览器预览为 ${layout.pages.length} 页，请以 Word 页面核对末页及跨页处` });
  // Printed labels can also occur in question text. Compare their positions
  // only when the entire extracted sequence matches the public numbering.
  if (actual.pages === layout.pages.length && actual.questionNumbers.flat().join(',') === sheet.questions.map(q => q.number).join(',')) {
    const starts = new Set<number>();
    for (const [index, page] of layout.pages.entries()) {
      const expected = page.questions.map(q => q.number).filter(n => !starts.has(n));
      expected.forEach(n => starts.add(n));
      if (expected.join(',') !== actual.questionNumbers[index].join(',')) {
        actual.findings.push({ page: index + 1, reason: '本页的起始题号分布与预览不同，请核对跨页题及书写区' });
      }
    }
  }
  return { status: actual.findings.length ? 'needs-review' : 'rendered', reasons, renderer: 'LibreOffice Writer', actual };
}
