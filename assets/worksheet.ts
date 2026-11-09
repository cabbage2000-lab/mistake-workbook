import { prepare, layout } from '@chenglou/pretext';
import katex from 'katex';
import type { PublicBlock, PublicQuestion, PublicSheet } from '../scripts/projection.ts';

const data: PublicSheet = JSON.parse(document.querySelector('#sheet-data')!.textContent!);
const mm = 96 / 25.4;
const [paperWidth, paperHeight] = data.layout.paperSize === 'A3' ? [297, 420] : [210, 297];
const papers: HTMLElement[] = [];
const root = document.querySelector<HTMLElement>('.pages')!;
const measurement = document.createElement('div'); measurement.className = 'measurement'; document.body.append(measurement);
const warnings = new Set(data.warnings);
let measurements = 0;
const font = `${data.layout.fontPt * 96 / 72}px "Workbook Sans"`;
const cache = new Map<string, ReturnType<typeof prepare>>();
function measure(text: string, width: number) {
  let prepared = cache.get(text); if (!prepared) { prepared = prepare(text, font); cache.set(text, prepared); }
  measurements++; return layout(prepared, Math.max(20, width), data.layout.fontPt * 96 / 72 * 1.6);
}
function el(tag: string, cls = '', text?: string): HTMLElement { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function richText(text: string, target: HTMLElement) {
  for (const part of text.split(/(\\\([\s\S]*?\\\))/g)) {
    if (part.startsWith('\\(') && part.endsWith('\\)')) { const span = el('span', 'formula'); katex.render(part.slice(2, -2), span, { throwOnError: true, trust: false, strict: 'error', output: 'html', maxExpand: 1000 }); target.append(span); }
    else target.append(document.createTextNode(part));
  }
}
function paragraphs(text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n').filter(Boolean)) {
    if (measure(paragraph, width).height < 40 * mm) { result.push(paragraph); continue; }
    const tokens = paragraph.match(/\\\([\s\S]*?\\\)|[^]/gu) || [];
    let chunk = '';
    for (const token of tokens) {
      chunk += token;
      if (chunk.length >= 40 && (/[，。！？；,.!?;\s]$/.test(token) || chunk.length >= 100) && measure(chunk, width).height > 24 * mm) { result.push(chunk); chunk = ''; }
    }
    if (chunk) result.push(chunk);
  }
  return result;
}
function cells(count: number, word?: string): HTMLElement {
  const group = el('div', 'grid-group');
  for (let i = 0; i < count; i++) group.append(el('span', 'hanzi-cell', word ? Array.from(word)[i] : undefined));
  return group;
}
function workspace(height: number, style: string, rowMm: number): HTMLElement[] {
  if (height <= 0) return [];
  const result: HTMLElement[] = [];
  // Distribute spare space between ruled rows instead of drawing a cramped final line.
  const count = style === 'four-line' ? Math.ceil(height / 18) : Math.max(1, Math.floor(height / rowMm));
  const h = style === 'four-line' ? 18 : height / count;
  for (let r = 0; r < count; r++) {
    const row = el('div', `workspace workspace-${style}`); row.style.height = `${h}mm`;
    row.dataset.workspaceMm = String(h);
    if (style === 'four-line') for (let i = 0; i < 4; i++) { const line = el('i'); line.style.top = `${3 + i * 4}mm`; row.append(line); }
    result.push(row);
  }
  return result;
}
function blocks(items: PublicBlock[], width: number): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const b of items) {
    switch (b.type) {
      case 'text': for (const text of paragraphs(b.text, width)) { const p = el('p', 'prompt'); richText(text, p); result.push(p); } break;
      case 'formula': { const p = el('div', 'formula formula-block'); katex.render(b.tex, p, { throwOnError: true, trust: false, strict: 'error', output: 'html', maxExpand: 1000, displayMode: true }); result.push(p); break; }
      case 'options': {
        b.items.forEach(t => { const options = el('div', 'options'); const p = el('p'); richText(t, p); options.append(p); result.push(options); }); break;
      }
      case 'image': {
        const figure = el('figure', 'question-image'); const img = document.createElement('img'); img.src = b.asset; img.alt = b.alt;
        const size = (window as any).__imageSizes[b.asset] as { width: number; height: number };
        const maxImageHeight = paperHeight - data.layout.marginMm * 2 - 58;
        const printable = Math.min(width / mm, b.widthMm ?? width / mm, maxImageHeight * size.width / size.height);
        if (printable < b.minWidthMm) { figure.dataset.tooWide = 'true'; }
        img.style.width = `${printable}mm`; img.style.height = `${printable * size.height / size.width}mm`;
        figure.append(img);
        if (b.containsWork) figure.append(el('figcaption', '', '按家长确认保留原图（含原作答）'));
        result.push(figure); break;
      }
      case 'pinyin': { const group = el('div', 'pinyin-group'); group.append(el('div', 'pinyin', b.text), cells(b.cells)); result.push(group); break; }
      case 'copy': {
        const sample = el('div', 'copy-sample'); sample.append(el('span', 'copy-caption', '范字'), cells(Array.from(b.word).length, b.word)); result.push(sample);
        for (let i = 0; i < b.repeats; i++) result.push(cells(Array.from(b.word).length)); break;
      }
      case 'table': {
        // Repeat column headings on each logical table chunk.
        for (let i = 1; i < b.rows.length || i === 1; i += 5) {
          const table = document.createElement('table'); table.className = 'question-table';
          const head = table.createTHead().insertRow(); b.rows[0].forEach(t => { const th = document.createElement('th'); th.textContent = t; head.append(th); });
          const body = table.createTBody(); b.rows.slice(i, i + 5).forEach(r => { const tr = body.insertRow(); r.forEach(t => { tr.insertCell().textContent = t; }); }); result.push(table);
        } break;
      }
      case 'subquestion': {
        const parts = blocks(b.blocks, width);
        const lead = el('div', 'subquestion-lead'); lead.append(el('p', 'subquestion-label', b.label));
        if (parts.length) lead.append(parts.shift()!);
        const ws = workspace(b.workspaceMm, b.workspaceStyle, b.workspaceRowMm);
        if (!parts.length && ws.length) lead.append(ws.shift()!);
        const group = el('div', 'subquestion'); group.append(lead, ...parts, ...ws);
        result.push(group); break;
      }
    }
  }
  return result;
}
function makeQuestion(q: PublicQuestion, width: number, continuation = false): HTMLElement {
  const article = el('article', 'question'); article.dataset.id = q.id; article.dataset.number = String(q.number);
  article.dataset.sectionId = q.sectionId;
  if (continuation) article.dataset.continuation = 'true';
  article.append(el('div', 'question-label', `${continuation ? `第 ${q.number} 题（续）` : `${q.number}.`}${data.draft && q.pending ? ' · 待确认' : ''}`));
  if (!continuation) article.append(...blocks(q.blocks, width), ...workspace(q.workspaceMm, q.workspaceStyle, q.workspaceRowMm));
  return article;
}
const subjectLabels: Record<string, string> = { math: '数学', chinese: '语文', english: '英语' };
function sectionHeading(sectionId: string, continuation = false): HTMLElement {
  const section = data.sections.find(s => s.id === sectionId)!;
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const n = section.number;
  const ordinal = n < 10 ? digits[n] : `${n >= 20 ? digits[Math.floor(n / 10)] : ''}十${digits[n % 10]}`;
  const heading = el('h3', 'section-heading', `${ordinal}、${section.title}${continuation ? '（续）' : ''}`);
  heading.dataset.sectionId = sectionId;
  if (continuation) heading.dataset.continuation = 'true';
  heading.append(el('span', 'section-count', `共 ${section.count} 题`));
  return heading;
}
function newPage(subject: string): HTMLElement {
  const paper = el('section', 'paper'); paper.style.setProperty('--paper-width', `${paperWidth}mm`); paper.style.setProperty('--paper-height', `${paperHeight}mm`);
  const header = el('header', 'sheet-header'); header.append(el('h2', '', data.title));
  header.append(el('div', 'sheet-meta', `${subjectLabels[subject]}${data.grade ? ` · ${data.grade}` : ''}　姓名：____________　日期：____________`));
  if (data.draft) header.append(el('div', 'draft-label', '草稿 · 存在待处理内容，禁止正式打印'));
  const body = el('div', 'sheet-body');
  const footer = el('footer', 'sheet-footer'); footer.append(el('span', '', `${data.layout.paperSize} · r${data.revision} · ${data.kind === 'student' ? '学生练习' : '独立答案册'}`), el('span', 'page-number'));
  paper.append(header, body, footer);
  const frame = el('div', 'paper-frame'); frame.id = `page-${papers.length + 1}`; frame.append(paper); root.append(frame); papers.push(paper);
  if (body.clientHeight < 60 * mm) throw new Error('标题过高，正文空间不足，请缩短标题');
  return body;
}
function fits(body: HTMLElement): boolean { return body.scrollHeight <= body.clientHeight + 1 && (!body.lastElementChild || body.lastElementChild.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + .5); }
function horizontalFits(q: HTMLElement): boolean {
  if (q.querySelector('[data-too-wide]')) return false;
  const right = q.getBoundingClientRect().right;
  return [q, ...Array.from(q.querySelectorAll<HTMLElement>('.formula,.grid-group,.pinyin,.question-table,.prompt,img'))].every(n => n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().right <= right + 1);
}
function row(columns: number): HTMLElement { const r = el('div', 'row'); r.style.setProperty('--columns', String(columns)); r.dataset.columns = String(columns); return r; }
async function render() {
  await document.fonts.load(`${data.layout.fontPt}pt "Workbook Sans"`); await document.fonts.ready;
  if (!document.fonts.check(`${data.layout.fontPt}pt "Workbook Sans"`)) throw new Error('中文字体加载失败');
  (window as any).__imageSizes = {};
  const assets = new Set<string>();
  function collect(bs: PublicBlock[]) { for (const b of bs) { if (b.type === 'image') assets.add(b.asset); if (b.type === 'subquestion') collect(b.blocks); } }
  data.questions.forEach(q => collect(q.blocks));
  await Promise.all([...assets].map(async src => { const img = new Image(); img.src = src; await img.decode(); if (!img.naturalWidth) throw new Error('题图加载失败'); (window as any).__imageSizes[src] = { width: img.naturalWidth, height: img.naturalHeight }; }));
  let body: HTMLElement | undefined; let currentRow: HTMLElement | undefined; let previousSubject = ''; let previousSection = '';
  const gap = data.layout.preset === 'compact' ? 3 : data.layout.preset === 'spacious' ? 7 : 5;
  for (const q of data.questions) {
    if (!body || q.subject !== previousSubject) { body = newPage(q.subject); currentRow = undefined; }
    previousSubject = q.subject;
    const startsSection = q.sectionId !== previousSection;
    const heading = startsSection ? sectionHeading(q.sectionId) : undefined;
    if (heading) { body.append(heading); currentRow = undefined; }
    previousSection = q.sectionId;
    let columns = q.columns; let article: HTMLElement | undefined;
    for (; columns >= 1; columns--) {
      const width = (body.clientWidth - (columns - 1) * gap * mm) / columns;
      measurement.style.width = `${width}px`; measurement.replaceChildren(makeQuestion(q, width)); article = measurement.firstElementChild as HTMLElement;
      if (horizontalFits(article) && !(q.type === 'oral' && columns > 1 && article.querySelectorAll('.prompt').length > 2)) break;
    }
    if (columns < 1 || !article) throw new Error(`第 ${q.number} 题超过单栏宽度：请拆分长公式、表格或调整字格/题图宽度`);
    if (columns !== q.columns) warnings.add(`第 ${q.number} 题由 ${q.columns} 栏调整为 ${columns} 栏，保持字号和书写区`);
    if (!currentRow || Number(currentRow.dataset.columns) !== columns || currentRow.children.length >= columns) { currentRow = row(columns); body.append(currentRow); }
    currentRow.append(article);
    if (fits(body)) continue;
    article.remove(); if (!currentRow.children.length) currentRow.remove();
    // Move a new section heading with its first question; never leave it at a page foot.
    heading?.remove();
    if (body.children.length) body = newPage(q.subject);
    body.append(sectionHeading(q.sectionId, !startsSection));
    currentRow = row(columns); body.append(currentRow); currentRow.append(article);
    if (fits(body)) continue;
    // One question is taller than a page: use full width and split only between logical blocks.
    currentRow.remove(); columns = 1;
    const full = makeQuestion(q, body.clientWidth);
    if (!horizontalFitsAfterMount(full, body.clientWidth)) throw new Error(`第 ${q.number} 题内容超过单栏宽度`);
    const chunks = Array.from(full.children).slice(1) as HTMLElement[];
    currentRow = row(1); body.append(currentRow);
    let fragment = makeQuestion(q, body.clientWidth, true); fragment.querySelector('.question-label')!.textContent = full.querySelector('.question-label')!.textContent;
    delete fragment.dataset.continuation; currentRow.append(fragment);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      fragment.append(chunk);
      if (fits(body)) continue;
      chunk.remove();
      if (fragment.children.length <= 1) {
        if (chunk.classList.contains('subquestion')) { chunks.splice(index, 1, ...Array.from(chunk.children) as HTMLElement[]); index--; continue; }
        throw new Error(`第 ${q.number} 题的单个内容块超过一页，请拆分材料或提供可读的局部题图`);
      }
      body = newPage(q.subject); body.append(sectionHeading(q.sectionId, true)); currentRow = row(1); body.append(currentRow);
      fragment = makeQuestion(q, body.clientWidth, true); fragment.append(chunk); currentRow.append(fragment);
      if (!fits(body)) {
        // Keep a subquestion's prompt and writing area together whenever a page
        // can hold them; only expand its logical parts when it exceeds a page.
        if (chunk.classList.contains('subquestion')) { chunk.remove(); chunks.splice(index, 1, ...Array.from(chunk.children) as HTMLElement[]); index--; continue; }
        throw new Error(`第 ${q.number} 题的单个内容块超过一页，请调整题图或按逻辑拆分`);
      }
    }
    warnings.add(`第 ${q.number} 题按逻辑内容块续页`); currentRow = undefined;
  }
  measurement.remove();
  if (data.layout.maxPages && papers.length > data.layout.maxPages) throw new Error(`需要 ${papers.length} 页，超过限制 ${data.layout.maxPages} 页。请减少题量、调整合法字号或留白；未丢弃题目`);
  const questionPages: Record<string, number[]> = {};
  papers.forEach((paper, i) => {
    paper.querySelector('.page-number')!.textContent = `第 ${i + 1} 页 / 共 ${papers.length} 页`;
    for (const q of paper.querySelectorAll<HTMLElement>('.question')) { const pages = questionPages[q.dataset.id!] ||= []; if (!pages.includes(i + 1)) pages.push(i + 1); }
    const link = el('a', 'page-link', `第 ${i + 1} 页`); link.setAttribute('href', `#page-${i + 1}`); document.querySelector('.page-nav')!.append(link);
  });
  const actualIds = Object.keys(questionPages);
  if (actualIds.length !== data.questions.length || data.questions.some(q => !questionPages[q.id])) throw new Error('题目 ID 对账失败');
  const report = { pages: papers.length, questions: data.questions.length, questionPages, fontPt: data.layout.fontPt, paperSize: data.layout.paperSize, pretextMeasurements: measurements, warnings: [...warnings] };
  (window as any).__worksheetReport = report;
  document.querySelector('.status')!.textContent = `${data.layout.paperSize} · ${data.sections.length} 个题型分组 · ${report.questions} 题 · ${report.pages} 页 · ${data.layout.fontPt} pt · r${data.revision}${data.draft ? ' · 草稿，待处理疑点' : ''}`;
  document.querySelector('.warnings')!.textContent = [...warnings].join('；');
  document.querySelector<HTMLButtonElement>('#print')!.disabled = data.draft;
  fit(); document.documentElement.dataset.ready = 'true';
}
function horizontalFitsAfterMount(node: HTMLElement, width: number): boolean { measurement.style.width = `${width}px`; measurement.replaceChildren(node); return horizontalFits(node); }
function fit() {
  const host = document.querySelector<HTMLElement>('.preview')!;
  const scale = Math.max(.1, Math.min(Number((document.querySelector('#zoom') as HTMLSelectElement).value) || 1, (host.clientWidth - 24) / (paperWidth * mm)));
  for (const paper of papers) { paper.style.transform = `scale(${scale})`; paper.parentElement!.style.width = `${paperWidth * mm * scale}px`; paper.parentElement!.style.height = `${paperHeight * mm * scale}px`; }
}
document.querySelector('#print')!.addEventListener('click', () => window.print());
document.querySelector('#collapse')!.addEventListener('click', () => { const state = document.body.classList.toggle('collapsed'); document.querySelector('#collapse')!.setAttribute('aria-expanded', String(!state)); fit(); });
document.querySelector('#zoom')!.addEventListener('change', fit); window.addEventListener('resize', fit);
render().catch(e => { measurement.remove(); document.documentElement.dataset.error = String(e.message || e); document.querySelector('.status')!.textContent = `生成失败：${e.message || e}`; document.querySelector('.status')!.classList.add('error'); });
