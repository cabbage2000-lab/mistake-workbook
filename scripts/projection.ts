import { calculate, formatRational } from './arithmetic.ts';
import { workspace, paperSizes, type Block, type Worksheet, type Layout } from './schema.ts';
import { organize, type Section } from './organization.ts';
export type PublicBlock = Exclude<Block, { type: 'dictation' } | { type: 'subquestion' }> | { type: 'subquestion'; label: string; blocks: PublicBlock[]; workspaceMm: number; workspaceStyle: string; workspaceRowMm: number };
export interface PublicQuestion { id: string; number: number; sectionId: string; subject: string; type: string; blocks: PublicBlock[]; oralExpression?: string; workspaceMm: number; workspaceStyle: string; workspaceRowMm: number; columns: number; pending: boolean }
export interface PublicSheet { title: string; subjectTitles: Record<string, string>; studentInfo?: string; oralLayout?: typeof oralLayout; grade?: string; date: string; revision: number; kind: 'student' | 'answers'; draft: boolean; layout: Layout; sections: Section[]; questions: PublicQuestion[]; warnings: string[] }
const subjectLabels = { math: '数学', chinese: '语文', english: '英语' };
const oralLayout = { instruction: '直接写出得数', continuation: '口算题（续）', numberWidthMm: 8, answerWidthMm: 21, rowHeightMm: 19 };

function oralExpression(question: Worksheet['questions'][number]): string | undefined {
  const [block] = question.blocks;
  if (question.workspace || question.blocks.length !== 1 || block.type !== 'text') return;
  return block.text.trim().match(/^(\d{1,6}(?:\.\d{1,3})?[ \t]*[+−–\-×÷*\/][ \t]*\d{1,6}(?:\.\d{1,3})?[ \t]*[=＝])[ \t]*[_＿]*$/)?.[1].replace(/[ \t]+/g, ' ');
}
function projectBlocks(blocks: Block[], preset: Layout['preset'], subject: Worksheet['questions'][number]['subject']): PublicBlock[] {
  return blocks.map(b => {
    switch (b.type) {
      case 'text': return { type: 'text', text: b.text };
      case 'formula': return { type: 'formula', tex: b.tex };
      case 'options': return { type: 'options', items: [...b.items] };
      case 'image': return { type: 'image', asset: b.asset, alt: b.alt, widthMm: b.widthMm, minWidthMm: b.minWidthMm, containsWork: b.containsWork, retainWorkConfirmed: b.retainWorkConfirmed };
      case 'pinyin': return { type: 'pinyin', text: b.text, cells: b.cells };
      case 'copy': return { type: 'copy', word: b.word, repeats: b.repeats };
      case 'table': return { type: 'table', rows: b.rows.map(r => [...r]) };
      case 'dictation': return { type: 'text', text: b.direction === 'zh-en' ? b.chinese : b.english };
      case 'subquestion': { const ws = workspace({ subject, type: 'generic', workspace: b.workspace }, preset); return { type: 'subquestion', label: b.label, blocks: projectBlocks(b.blocks, preset, subject), workspaceMm: ws.mm, workspaceStyle: ws.style, workspaceRowMm: ws.rowMm }; }
    }
  });
}
export function verifiedAnswer(q: Worksheet['questions'][number]): string {
  const a = q.answer;
  if (!a?.verified) return '未提供';
  if (a.expression) {
    const result = calculate(a.expression); const provided = calculate(a.text);
    if (result.n !== provided.n || result.d !== provided.d) throw new Error(`${q.id} 参考答案与确定性计算结果不符`);
    return formatRational(result);
  }
  return a.text;
}
export function project(w: Worksheet, kind: 'student' | 'answers', draft = false): PublicSheet {
  const warnings: string[] = [];
  const groups = organize(w.questions);
  const title = kind === 'answers' ? `${w.title} · 答案册` : w.title;
  const subjects = [...new Set(groups.map(group => group.section.subject))];
  const subjectTitles = Object.fromEntries(subjects.map(subject => [subject, subjects.length > 1 ? `${title} · ${subjectLabels[subject]}` : title]));
  const studentInfo = kind === 'student' ? '班级  ________________　　　　姓名  ________________' : undefined;
  const questions = groups.flatMap(group => group.questions.map(q => ({ q, sectionId: group.section.id }))).map(({ q, sectionId }, index): PublicQuestion => {
    const ws = workspace(q, w.layout.preset);
    const expression = kind === 'student' && !draft && q.subject === 'math' && q.type === 'oral' ? oralExpression(q) : undefined;
    const columns = q.columns ?? (w.layout.columns === 'auto' ? q.type === 'oral' ? 3 : ['vertical', 'mixed', 'dictation', 'pinyin', 'copy'].includes(q.type) ? 2 : 1 : w.layout.columns);
    if (q.type === 'dictation' && q.workspace?.mm === undefined && q.workspace?.lines === undefined) {
      const gap = w.layout.preset === 'compact' ? 3 : w.layout.preset === 'spacious' ? 7 : 5;
      const availableMm = (paperSizes[w.layout.paperSize][0] - w.layout.marginMm * 2 - (columns - 1) * gap) / columns;
      for (const b of q.blocks) if (b.type === 'dictation') {
        const target = b.direction === 'zh-en' ? b.english : b.chinese;
        const writingMm = Array.from(target).reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 11 : 3.5), 0);
        ws.mm = Math.max(ws.mm, Math.ceil(writingMm / availableMm) * ws.rowMm);
      }
    }
    return { id: q.id, number: index + 1, sectionId, subject: q.subject, type: q.type, columns: kind === 'answers' ? 1 : columns,
      pending: q.confirmation !== 'confirmed' || q.issues.some(i => !i.resolved),
      blocks: kind === 'student' ? projectBlocks(q.blocks, w.layout.preset, q.subject) : [{ type: 'text', text: verifiedAnswer(q) }],
      oralExpression: expression,
      workspaceMm: kind === 'student' && !expression ? ws.mm : 0, workspaceStyle: ws.style, workspaceRowMm: ws.rowMm };
  });
  const oral = questions.some(q => q.oralExpression) ? { ...oralLayout, numberWidthMm: questions.length >= 100 ? 10 : oralLayout.numberWidthMm } : undefined;
  return { title, subjectTitles, studentInfo, oralLayout: oral, grade: w.grade, date: w.date, revision: w.revision, kind, draft, layout: { ...w.layout }, sections: groups.map(g => g.section), questions, warnings };
}
