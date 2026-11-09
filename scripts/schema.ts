import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text = z.string().min(1).max(100000);
export const paperSizes = { A3: [297, 420], A4: [210, 297] } as const;
export const questionTypes = ['oral', 'vertical', 'mixed', 'application', 'pinyin', 'copy', 'dictation', 'choice', 'judgment', 'fill', 'reading', 'generic'] as const;
const image = z.object({
  type: z.literal('image'), asset: text, alt: text, widthMm: z.number().min(15).max(269).optional(),
  minWidthMm: z.number().min(15).max(269).default(35),
  containsWork: z.boolean().default(false), retainWorkConfirmed: z.boolean().default(false)
}).strict();
const simpleBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text }).strict(),
  z.object({ type: z.literal('formula'), tex: text }).strict(), image,
  z.object({ type: z.literal('options'), items: z.array(text).min(1).max(20) }).strict(),
  z.object({ type: z.literal('table'), rows: z.array(z.array(z.string().max(1000)).min(1).max(15)).min(1).max(200) }).strict(),
  z.object({ type: z.literal('pinyin'), text, cells: z.number().int().min(1).max(30) }).strict(),
  z.object({ type: z.literal('copy'), word: text, repeats: z.number().int().min(1).max(10).default(3) }).strict(),
  z.object({ type: z.literal('dictation'), chinese: text, english: text, direction: z.enum(['zh-en', 'en-zh']).default('zh-en') }).strict()
]);
export const workspaceSchema = z.object({
  mm: z.number().min(0).max(1000).optional(), lines: z.number().int().min(0).max(100).optional(),
  style: z.enum(['blank', 'lines', 'four-line']).optional()
}).strict().refine(v => v.mm === undefined || v.lines === undefined, 'mm 与 lines 只能设置一个');
const subquestion = z.object({ type: z.literal('subquestion'), label: text, blocks: z.array(simpleBlock).min(1), workspace: workspaceSchema.optional() }).strict();
export const blockSchema = z.union([simpleBlock, subquestion]);
export const questionSchema = z.object({
  id, sourceRefs: z.array(z.object({ sourceId: id, location: text, originalNumber: z.string().optional(), region: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().positive(), z.number().positive()]).optional() }).strict()).min(1),
  subject: z.enum(['math', 'chinese', 'english']), type: z.enum(questionTypes).default('generic'),
  blocks: z.array(blockSchema).min(1), selected: z.boolean().default(true),
  confirmation: z.enum(['pending', 'confirmed']).default('pending'),
  issues: z.array(z.object({ id, message: text, resolved: z.boolean().default(false), resolution: z.string().optional() }).strict()).default([]),
  workspace: workspaceSchema.optional(), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  answer: z.object({ text, verified: z.boolean().default(false), provenance: text, expression: z.string().optional() }).strict().optional(),
  editedByUser: z.boolean().default(false), version: z.number().int().positive().default(1),
  excludedReason: z.string().optional()
}).strict();
export const sourceSchema = z.object({
  id, type: z.enum(['text', 'image']), label: text, text: z.string().optional(), asset: z.string().optional(), originalAsset: z.string().optional(),
  status: z.enum(['pending', 'processing', 'complete', 'partial', 'failed', 'cancelled']).default('pending'),
  coverage: z.enum(['unchecked', 'checked']).default('unchecked'), scopeConfirmed: z.boolean().default(false),
  location: z.string().optional(), error: z.string().optional(),
  candidateCount: z.number().int().nonnegative().optional()
}).strict();
export const layoutSchema = z.object({
  paperSize: z.enum(['A3', 'A4']).default('A4'), paperReason: z.enum(['explicit', 'exam', 'default']).default('default'),
  preset: z.enum(['standard', 'compact', 'spacious']).default('standard'),
  fontPt: z.number().min(12).max(20).default(14), marginMm: z.number().min(10).max(30).default(14),
  columns: z.union([z.literal('auto'), z.literal(1), z.literal(2), z.literal(3)]).default('auto'),
  cellMm: z.union([z.literal(11), z.literal(12)]).default(11),
  maxPages: z.number().int().min(1).max(200).optional()
}).strict();
export const worksheetSchema = z.object({
  schemaVersion: z.literal(1).default(1), id, title: z.string().min(1).max(100), grade: z.string().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), request: z.string().default(''),
  revision: z.number().int().positive().default(1),
  stage: z.enum(['intake', 'organize', 'review', 'layout', 'preview', 'export']).default('intake'),
  sources: z.array(sourceSchema).default([]), questions: z.array(questionSchema).default([]),
  layout: layoutSchema.prefault({}),
  conflicts: z.array(z.object({ id, questionId: id, proposal: questionSchema, reason: text }).strict()).default([]),
  timings: z.array(z.object({ stage: text, durationMs: z.number().nonnegative() }).strict()).default([])
}).strict();
export type Worksheet = z.infer<typeof worksheetSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Layout = z.infer<typeof layoutSchema>;

export function today(): string { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
export function inferPaper(request: string, explicit?: 'A3' | 'A4'): Pick<Layout, 'paperSize' | 'paperReason'> {
  const match = explicit || request.match(/\bA[34]\b/i)?.[0].toUpperCase() as 'A3' | 'A4' | undefined;
  return match ? { paperSize: match, paperReason: 'explicit' } : request.includes('试卷') ? { paperSize: 'A3', paperReason: 'exam' } : { paperSize: 'A4', paperReason: 'default' };
}
export function parseWorksheet(input: unknown): Worksheet {
  const w = worksheetSchema.parse(input);
  for (const [label, items] of [['来源', w.sources], ['题目', w.questions]] as const) {
    if (new Set(items.map(x => x.id)).size !== items.length) throw new Error(`${label} ID 重复`);
  }
  const ids = new Set(w.sources.map(s => s.id));
  for (const q of w.questions) {
    for (const ref of q.sourceRefs) if (!ids.has(ref.sourceId)) throw new Error(`${q.id} 引用了不存在的来源 ${ref.sourceId}`);
    if (new Set(q.issues.map(x => x.id)).size !== q.issues.length) throw new Error(`${q.id} 疑点 ID 重复`);
    if (q.confirmation === 'confirmed' && q.issues.some(x => !x.resolved)) throw new Error(`${q.id} 仍有未解决疑点，不能标记已确认`);
  }
  if (w.questions.filter(q => q.selected).length > 100) throw new Error('超过已验证的 100 题范围，请分批生成；未截取题目');
  return w;
}
export function images(blocks: Block[]): z.infer<typeof image>[] {
  return blocks.flatMap(b => b.type === 'image' ? [b] : b.type === 'subquestion' ? images(b.blocks) : []);
}
export function blockers(w: Worksheet): string[] {
  const problems: string[] = [];
  const selected = w.questions.filter(q => q.selected);
  if (!selected.length) problems.push('尚未选中题目');
  for (const q of selected) {
    if (q.confirmation !== 'confirmed') problems.push(`${q.id} 待确认`);
    for (const i of q.issues.filter(i => !i.resolved)) problems.push(`${q.id}: ${i.message}`);
    for (const img of images(q.blocks)) if (img.containsWork && !img.retainWorkConfirmed) problems.push(`${q.id} 题图含作答，需明确确认保留、转录或排除`);
    for (const ref of q.sourceRefs) {
      const s = w.sources.find(s => s.id === ref.sourceId)!;
      if (!s.scopeConfirmed || s.coverage !== 'checked' || !['complete', 'partial'].includes(s.status)) problems.push(`${q.id} 来源 ${s.id} 尚未核对收录范围/覆盖情况`);
    }
  }
  for (const c of w.conflicts) if (selected.some(q => q.id === c.questionId)) problems.push(`${c.questionId} 重新识别冲突待处理`);
  return [...new Set(problems)];
}
export const defaults = { oral: 12, vertical: 48, mixed: 56, application: 64, pinyin: 0, copy: 0, dictation: 14, choice: 8, judgment: 8, fill: 8, reading: 0, generic: 24 };
export function workspace(q: Pick<Question, 'type' | 'workspace'> & Partial<Pick<Question, 'subject'>>, preset: Layout['preset']): { mm: number; style: string; rowMm: number } {
  const style = q.workspace?.style ?? (q.subject === 'math' || ['oral', 'vertical', 'mixed', 'application'].includes(q.type) ? 'blank' : 'lines');
  const rowMm = style === 'four-line' ? 18 : style === 'lines' && q.type === 'dictation' ? 14 : 8;
  const explicitSize = q.workspace?.mm !== undefined || q.workspace?.lines !== undefined;
  const base = q.workspace?.mm ?? (q.workspace?.lines !== undefined ? q.workspace.lines * rowMm : defaults[q.type]);
  const multiplier = preset === 'compact' ? .85 : preset === 'spacious' ? 1.25 : 1;
  const minimum = ['pinyin', 'copy', 'reading', 'choice', 'judgment', 'fill'].includes(q.type) ? 0 : q.type === 'oral' ? 12 : q.type === 'dictation' ? 14 : q.type === 'vertical' ? 40 : q.type === 'mixed' ? 48 : q.type === 'application' ? 48 : 8;
  const height = Math.max(minimum, explicitSize ? base : base * multiplier);
  // Four-line handwriting rows are indivisible; never squeeze a row into a remainder.
  return { mm: style === 'four-line' ? Math.ceil(height / rowMm) * rowMm : height, style, rowMm };
}
