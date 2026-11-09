import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { blockers, images, inferPaper, parseWorksheet, questionSchema, sourceSchema, today, type Worksheet, type Question } from './schema.ts';
import { organize } from './organization.ts';

export function fingerprint(w: Worksheet): string {
  // Workflow progress is runtime metadata; it must not invalidate its own artifacts.
  const { stage, timings, ...content } = w;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }); }
}
export async function loadTask(directory: string): Promise<Worksheet> { return parseWorksheet(JSON.parse(await readFile(join(directory, 'task.json'), 'utf8'))); }
export async function withLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true });
  const lock = join(directory, '.task.lock');
  let handle;
  try { handle = await open(lock, 'wx'); }
  catch (e) { throw new Error(`任务正由另一操作写入；稍后重试。进程意外终止时，确认无运行操作再移除 ${lock}`, { cause: e }); }
  try { await handle.writeFile(String(process.pid)); return await action(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}
async function persist(directory: string, w: Worksheet): Promise<void> {
  await atomicJson(join(directory, 'revisions', `r${String(w.revision).padStart(4, '0')}.json`), w);
  await atomicJson(join(directory, 'task.json'), w);
}
export async function createTask(directory: string, input: unknown): Promise<Worksheet> {
  return withLock(directory, async () => {
    try { await readFile(join(directory, 'task.json')); throw new Error('任务目录已存在，请使用新目录或读取后修订'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const w = parseWorksheet(input); await persist(directory, w); return w;
  });
}
export function newTask(title: string, request = '', paper?: 'A3' | 'A4'): Worksheet {
  return parseWorksheet({ id: `w-${randomUUID()}`, title, request, date: today(), layout: inferPaper(request, paper) });
}
type Operation = { op: string; [key: string]: unknown };
export interface Patch { expectedRevision: number; operations: Operation[] }
function semantic(q: Question): string { return JSON.stringify([q.blocks, q.sourceRefs, q.subject, q.type]); }
function resetQuestion(q: Question): void { q.confirmation = 'pending'; q.version++; q.editedByUser = true; if (q.answer) q.answer.verified = false; }
export function applyOperations(original: Worksheet, patch: Patch): Worksheet {
  if (!patch || patch.expectedRevision !== original.revision) throw new Error(`修订冲突：当前 r${original.revision}，请重新读取任务后合并修改`);
  if (!Array.isArray(patch.operations) || !patch.operations.length) throw new Error('operations 不能为空');
  const w = structuredClone(original);
  const get = (v: unknown): Question => { const q = w.questions.find(q => q.id === v); if (!q) throw new Error(`题目不存在：${String(v)}`); return q; };
  for (const op of patch.operations) {
    switch (op.op) {
      case 'addSource': w.sources.push(sourceSchema.parse(op.source)); break;
      case 'updateSource': {
        const index = w.sources.findIndex(s => s.id === op.id); if (index < 0) throw new Error(`来源不存在：${op.id}`);
        const changes = op.changes as Record<string, unknown>;
        if ('id' in changes || 'asset' in changes || 'text' in changes || 'originalAsset' in changes) throw new Error('更换来源内容请使用 reidentify，以保留人工修订');
        w.sources[index] = sourceSchema.parse({ ...w.sources[index], ...changes }); break;
      }
      case 'addQuestion': w.questions.push(questionSchema.parse(op.question)); break;
      case 'updateQuestion': {
        const q = get(op.id); const changes = op.changes as Record<string, unknown>;
        if (['id', 'confirmation', 'version', 'issues', 'editedByUser'].some(k => k in changes)) throw new Error('题目身份、疑点和确认状态请使用专用操作修改');
        const updated = questionSchema.parse({ ...q, ...changes });
        const contentChanged = semantic(q) !== semantic(updated);
        Object.assign(q, updated); q.editedByUser = true; if (contentChanged) resetQuestion(q); break;
      }
      case 'select': { const q = get(op.id); if (typeof op.selected !== 'boolean') throw new Error('selected 必须为布尔值'); q.selected = op.selected; q.editedByUser = true; q.excludedReason = op.selected ? undefined : String(op.reason || '家长排除'); break; }
      case 'confirm': {
        const q = get(op.id);
        if (q.issues.some(i => !i.resolved)) throw new Error(`${q.id} 仍有未解决疑点，先按疑点 ID resolveIssue`);
        if (images(q.blocks).some(i => i.containsWork && !i.retainWorkConfirmed)) throw new Error(`${q.id} 题图仍含作答，需明确保留确认`);
        q.confirmation = 'confirmed'; break;
      }
      case 'addIssue': { const q = get(op.id); q.issues.push({ ...(op.issue as any), resolved: false }); q.confirmation = 'pending'; q.editedByUser = true; break; }
      case 'resolveIssue': {
        const q = get(op.id); const issue = q.issues.find(i => i.id === op.issueId);
        if (!issue || typeof op.resolution !== 'string' || !op.resolution.trim()) throw new Error('需要有效的疑点 ID 和明确 resolution');
        issue.resolved = true; issue.resolution = op.resolution; q.editedByUser = true; break;
      }
      case 'retainImageWork': {
        const q = get(op.id); if (op.confirmed !== true) throw new Error('必须明确 confirmed:true 才可保留原图作答');
        const matches = images(q.blocks).filter(i => i.asset === op.asset && i.containsWork);
        if (!matches.length) throw new Error('找不到包含作答的对应题图');
        matches.forEach(i => { i.retainWorkConfirmed = true; }); q.confirmation = 'pending'; break;
      }
      case 'layout': w.layout = { ...w.layout, ...(op.changes as object) }; if ((op.changes as any).paperSize) w.layout.paperReason = 'explicit'; break;
      case 'metadata': {
        const changes = op.changes as Record<string, unknown>;
        if (Object.keys(changes).some(k => !['title', 'grade', 'date'].includes(k))) throw new Error('metadata 只允许 title/grade/date');
        Object.assign(w, changes); break;
      }
      case 'reorder': {
        const ids = op.ids as string[];
        if (!Array.isArray(ids) || ids.length !== w.questions.length || new Set(ids).size !== ids.length) throw new Error('排序必须完整包含所有题目 ID 各一次');
        w.questions = ids.map(get); break;
      }
      case 'merge': {
        const ids = op.ids as string[];
        if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('合并需至少两个不同题目');
        const qs = ids.map(get); const index = Math.min(...qs.map(q => w.questions.indexOf(q)));
        const merged = questionSchema.parse(op.question); merged.confirmation = 'pending'; merged.editedByUser = true; if (merged.answer) merged.answer.verified = false;
        const refs = qs.flatMap(q => q.sourceRefs);
        if (refs.some(ref => !merged.sourceRefs.some(r => r.sourceId === ref.sourceId && r.location === ref.location))) throw new Error('合并题须保留全部来源定位');
        if (w.questions.some(q => !ids.includes(q.id) && q.id === merged.id)) throw new Error('合并题 ID 已占用');
        w.questions = w.questions.filter(q => !ids.includes(q.id)); w.questions.splice(index, 0, merged); break;
      }
      case 'split': {
        const q = get(op.id); const index = w.questions.indexOf(q);
        const children = (op.questions as unknown[]).map(x => questionSchema.parse(x));
        if (children.length < 2) throw new Error('拆分需至少两题');
        for (const c of children) { c.confirmation = 'pending'; c.editedByUser = true; if (c.answer) c.answer.verified = false; if (!c.sourceRefs.some(r => q.sourceRefs.some(s => s.sourceId === r.sourceId))) throw new Error('拆分题必须可追溯到原来源'); }
        w.questions.splice(index, 1, ...children); break;
      }
      case 'reidentify': {
        const source = w.sources.find(s => s.id === op.sourceId); if (!source) throw new Error('来源不存在');
        const proposals = (op.questions as unknown[]).map(x => questionSchema.parse(x));
        if (op.source) Object.assign(source, sourceSchema.parse({ ...source, ...(op.source as object), id: source.id }));
        for (const proposal of proposals) {
          if (!proposal.sourceRefs.some(r => r.sourceId === source.id)) throw new Error('重新识别题目缺少对应来源引用');
          const existing = w.questions.find(q => q.id === proposal.id);
          proposal.confirmation = 'pending'; if (proposal.answer) proposal.answer.verified = false;
          if (existing?.editedByUser) w.conflicts.push({ id: `c-${randomUUID()}`, questionId: existing.id, proposal, reason: '重新识别与人工编辑版本冲突，请对照后保留或采用新版本' });
          else if (existing) { proposal.version = existing.version + 1; w.questions[w.questions.indexOf(existing)] = proposal; }
          else w.questions.push(proposal);
        }
        // Unreturned candidates stay visible: the host must explicitly exclude them.
        source.coverage = 'unchecked'; source.scopeConfirmed = false; break;
      }
      case 'resolveConflict': {
        const c = w.conflicts.find(c => c.id === op.id); if (!c) throw new Error('冲突不存在');
        if (!['keep', 'replace'].includes(String(op.choice))) throw new Error('choice 只能为 keep 或 replace');
        if (op.choice === 'replace') { const q = get(c.questionId); const index = w.questions.indexOf(q); w.questions[index] = { ...c.proposal, version: q.version + 1, editedByUser: true, confirmation: 'pending' }; }
        w.conflicts = w.conflicts.filter(v => v.id !== c.id); break;
      }
      case 'timing': w.timings.push(op.timing as any); break;
      default: throw new Error(`未知操作：${op.op}`);
    }
  }
  w.revision++;
  w.stage = blockers(w).length ? 'review' : 'layout';
  return parseWorksheet(w);
}
export async function updateTask(directory: string, patch: Patch): Promise<Worksheet> {
  return withLock(directory, async () => { const w = applyOperations(await loadTask(directory), patch); await persist(directory, w); return w; });
}
export async function currentExport(directory: string): Promise<unknown> {
  const w = await loadTask(directory);
  let attempt: any = null;
  try { attempt = JSON.parse(await readFile(join(directory, 'generation.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (attempt?.status === 'generating' && Number.isInteger(attempt.pid)) {
    try { process.kill(attempt.pid, 0); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') attempt = { ...attempt, status: 'failed', error: '上次生成进程已退出，结果可能不完整；请重试生成。任务内容已保留。' }; }
  }
  try {
    const result = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
    return { ...result, stale: result.fingerprint !== fingerprint(w), currentRevision: w.revision, latestAttempt: attempt, generating: attempt?.status === 'generating' };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { latestAttempt: attempt, currentRevision: w.revision, generating: attempt?.status === 'generating' }; }
}
export function summary(w: Worksheet) {
  let number = 0;
  const sections = organize(w.questions).map(group => ({ ...group.section, questions: group.questions.map(q => ({ id: q.id, number: ++number })) }));
  return { id: w.id, title: w.title, revision: w.revision, stage: w.stage, paperSize: w.layout.paperSize, layout: w.layout,
    sections,
    selected: w.questions.filter(q => q.selected).length, confirmed: w.questions.filter(q => q.selected && q.confirmation === 'confirmed').length,
    excluded: w.questions.filter(q => !q.selected).map(q => ({ id: q.id, reason: q.excludedReason })),
    blockers: blockers(w), sources: w.sources.map(s => ({ id: s.id, status: s.status, coverage: s.coverage, scopeConfirmed: s.scopeConfirmed, candidates: w.questions.filter(q => q.sourceRefs.some(r => r.sourceId === s.id)).map(q => q.id), expectedCandidates: s.candidateCount })),
    questions: w.questions.map(q => ({ id: q.id, selected: q.selected, subject: q.subject, type: q.type, confirmation: q.confirmation, sources: q.sourceRefs, issues: q.issues.filter(i => !i.resolved) })) };
}
