import type { PublicBlock, PublicQuestion, PublicSheet } from '../scripts/projection.ts';

const pxPerMm = 96 / 25.4;
const mm = (pixels: number) => Math.round(pixels / pxPerMm * 10) / 10;
const bodyOf = (paper: HTMLElement) => paper.querySelector<HTMLElement>('.sheet-body')!;
const rowsOf = (body: HTMLElement) => [...body.querySelectorAll<HTMLElement>(':scope > .row')];

interface Finding {
  code: 'single-tail-row' | 'detached-workspace';
  page: number; questionIds: string[]; numbers: number[]; reason: string;
}
interface MeasuredQuestion { id: string; number: number; workspaceMm: number; answerWidthMm?: number }
interface PageEvidence { page: number; remainingMm: number; questions: MeasuredQuestion[] }
export interface LayoutReview {
  decision: 'first-pass' | 'revised' | 'kept-original';
  initial: Finding[]; remaining: Finding[]; pages: PageEvidence[]; initialPages?: PageEvidence[];
  continuationBreaks?: { id: string; block: number }[];
}

function childSpace(blocks: PublicBlock[]): number {
  return blocks.reduce((sum, block) => sum + (block.type === 'subquestion' ? block.workspaceMm + childSpace(block.blocks) : 0), 0);
}

function measurePages(papers: HTMLElement[], sheet: PublicSheet) {
  const totals = new Map<string, number>();
  const ordered: string[] = [];
  const pages: PageEvidence[] = papers.map((paper, index) => {
    const body = bodyOf(paper);
    const area = body.getBoundingClientRect();
    const questions = [...body.querySelectorAll<HTMLElement>('.question')].map(article => {
      const id = article.dataset.id!;
      const number = Number(article.dataset.number);
      const box = article.getBoundingClientRect();
      const fail = (message: string) => { throw new Error(`第 ${index + 1} 页第 ${number} 题${message}`); };
      if (box.left < area.left - 1 || box.right > area.right + 1 || box.bottom > area.bottom + 1 || box.top < area.top - 1 ||
          article.scrollWidth > article.clientWidth + 1) fail('超出打印正文边界');
      let space = 0;
      for (const row of article.querySelectorAll<HTMLElement>('.workspace')) {
        const height = row.getBoundingClientRect().height / pxPerMm;
        if (height + 0.02 < Number(row.dataset.workspaceMm)) fail('书写行高度不足');
        space += Number(row.dataset.workspaceMm);
      }
      const blank = article.querySelector('.oral-answer');
      const answerWidthMm = blank ? mm(blank.getBoundingClientRect().width) : undefined;
      if (answerWidthMm !== undefined && answerWidthMm < sheet.oralLayout!.answerWidthMm - 0.1) fail('得数横线宽度不足');
      totals.set(id, (totals.get(id) ?? 0) + space);
      if (!article.dataset.continuation) ordered.push(id);
      return { id, number, workspaceMm: Math.round(space * 10) / 10, answerWidthMm };
    });
    if (!questions.length) throw new Error(`第 ${index + 1} 页没有题目`);
    for (const heading of body.querySelectorAll<HTMLElement>('.section-heading')) {
      const next = heading.nextElementSibling?.querySelector<HTMLElement>('.question');
      if (next?.dataset.sectionId !== heading.dataset.sectionId) throw new Error(`第 ${index + 1} 页题型标题与首题分离`);
    }
    return { page: index + 1, remainingMm: mm(area.bottom - body.lastElementChild!.getBoundingClientRect().bottom), questions };
  });
  if (ordered.length !== sheet.questions.length || sheet.questions.some((q, i) => ordered[i] !== q.id)) throw new Error('实际题目数量或顺序与任务不符');
  for (const q of sheet.questions) {
    if (Math.abs(totals.get(q.id)! - q.workspaceMm - childSpace(q.blocks)) > 0.05) throw new Error(`第 ${q.number} 题书写区总高度与任务不符`);
  }
  return pages;
}

function findings(papers: HTMLElement[], byId: Map<string, PublicQuestion>): Finding[] {
  const result: Finding[] = [];
  for (let i = 1; i < papers.length; i++) {
    const body = bodyOf(papers[i]);
    const rows = rowsOf(body);
    const previous = rowsOf(bodyOf(papers[i - 1]));
    const first = rows[0].firstElementChild as HTMLElement;
    const questions = [...rows[0].children] as HTMLElement[];
    const report = (code: Finding['code'], reason: string) => result.push({
      code, page: i + 1, questionIds: questions.map(q => q.dataset.id!), numbers: questions.map(q => Number(q.dataset.number)), reason,
    });
    if (first.dataset.continuation && first.children.length > 1 &&
        [...first.children].slice(1).every(node => node.classList.contains('workspace')) &&
        first.getBoundingClientRect().height < body.clientHeight / 3) {
      report('detached-workspace', '续页只剩少量书写行，检查能否将上一段题面随行移入');
    }
    if (i === papers.length - 1 && rows.length === 1 && previous.length >= 3 &&
        previous.at(-2)!.lastElementChild?.getAttribute('data-section-id') === first.dataset.sectionId &&
        previous.at(-1)!.lastElementChild?.getAttribute('data-section-id') === first.dataset.sectionId &&
        questions.every(q => !q.dataset.continuation && ['oral', 'choice', 'judgment', 'fill', 'dictation'].includes(byId.get(q.dataset.id!)!.type)) &&
        rows[0].getBoundingClientRect().height < body.clientHeight / 4) {
      report('single-tail-row', '同组短题的末页仅一行，尝试并回前页或均分末两页的题行');
    }
  }
  return result;
}

// Try a single candidate on the measured pages. Keep the original DOM nodes so
// that every move, including removal of an empty final page, is reversible.
export function reviewLayout(papers: HTMLElement[], sheet: PublicSheet, fits: (body: HTMLElement) => boolean): LayoutReview {
  const byId = new Map(sheet.questions.map(q => [q.id, q]));
  const pages = measurePages(papers, sheet);
  const initial = findings(papers, byId);
  if (!initial.length) return { decision: 'first-pass', initial, remaining: [], pages };

  const undo: (() => void)[] = [];
  const continuationBreaks: { id: string; block: number }[] = [];
  function move(node: Element, parent: Element, before: Element | null = null) {
    const from = node.parentElement!;
    const next = node.nextElementSibling;
    parent.insertBefore(node, before);
    undo.push(() => from.insertBefore(node, next));
  }
  for (const issue of initial) {
    const body = bodyOf(papers[issue.page - 1]);
    const previous = bodyOf(papers[issue.page - 2]);
    if (issue.code === 'single-tail-row') {
      const tail = rowsOf(body)[0];
      move(tail, previous);
      if (fits(previous)) {
        const paper = papers.pop()!;
        const frame = paper.parentElement!;
        const parent = frame.parentElement!;
        frame.remove();
        undo.push(() => { parent.append(frame); papers.push(paper); });
      } else {
        undo.pop()!();
        const sectionId = byId.get(issue.questionIds[0])!.sectionId;
        const sameSection = (row: HTMLElement) => row.firstElementChild?.getAttribute('data-section-id') === sectionId;
        const rows = rowsOf(previous);
        const count = rows.toReversed().findIndex(row => !sameSection(row));
        const available = count === -1 ? rows.length : count;
        for (let n = 0; n < Math.floor((available - 1) / 2); n++) {
          const row = rows.pop()!;
          if (row.querySelector('[data-continuation]')) break;
          move(row, body, rowsOf(body)[0]);
          if (!fits(body)) { undo.pop()!(); break; }
        }
      }
    } else {
      const source = rowsOf(previous).at(-1)!.lastElementChild!;
      const dest = rowsOf(body)[0].firstElementChild!;
      if (source.getAttribute('data-id') !== issue.questionIds[0]) continue;
      const content = [...source.children].slice(1);
      const anchor = content.findLastIndex(node => !node.classList.contains('workspace'));
      // A lone prompt belongs with the first answer lines. A later subquestion
      // may move as a unit if substantive material remains on the preceding page.
      if (anchor < 1 || !content[anchor].matches('.prompt[data-block-start],.subquestion[data-block-start]')) continue;
      const before = dest.children[1];
      const checkpoint = undo.length;
      for (const node of content.slice(anchor)) move(node, dest, before);
      if (!fits(body)) while (undo.length > checkpoint) undo.pop()!();
      else continuationBreaks.push({ id: issue.questionIds[0], block: Number(content[anchor].getAttribute('data-block-start')) });
    }
  }
  try {
    const candidate = measurePages(papers, sheet);
    const remaining = findings(papers, byId);
    if (remaining.length < initial.length && remaining.every(f => initial.some(original => original.code === f.code && original.questionIds[0] === f.questionIds[0]))) {
      return { decision: 'revised', initial, remaining, initialPages: pages, pages: candidate, continuationBreaks };
    }
  } catch { /* Fall back to the first layout, which passed the same checks. */ }
  while (undo.length) undo.pop()!();
  return { decision: 'kept-original', initial, remaining: initial, pages };
}
