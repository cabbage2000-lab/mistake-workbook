import { questionTypes, type Question } from './schema.ts';

export interface Section { id: string; subject: Question['subject']; type: Question['type']; title: string; number: number; count: number }
const orders: Record<Question['subject'], Question['type'][]> = {
  math: ['fill', 'choice', 'judgment', 'oral', 'vertical', 'mixed', 'application', 'reading', 'generic'],
  chinese: ['pinyin', 'copy', 'dictation', 'choice', 'judgment', 'fill', 'generic', 'reading'],
  english: ['dictation', 'choice', 'judgment', 'fill', 'generic', 'reading']
};
const labels: Record<Question['type'], string> = {
  oral: '口算题', vertical: '竖式计算', mixed: '脱式计算', application: '解决问题',
  pinyin: '看拼音写词语', copy: '词语抄写', dictation: '词语默写', choice: '选择题',
  judgment: '判断题', fill: '填空题', reading: '阅读理解', generic: '综合题'
};
function category(q: Question): { key: string; title: string } {
  if (q.type === 'dictation') {
    const directions = new Set(q.blocks.filter(b => b.type === 'dictation').map(b => b.direction));
    if (directions.size === 1) {
      const direction = [...directions][0];
      return { key: `dictation-${direction}`, title: direction === 'zh-en' ? '中译英' : '英译中' };
    }
  }
  return { key: q.type, title: q.type === 'reading' && q.subject === 'math' ? '图表与材料题' : labels[q.type] };
}

// Keep source records untouched: only the public paper order changes. Subjects use
// their first selected occurrence; ties within each section keep the input order.
export function organize(questions: Question[]): { section: Section; questions: Question[] }[] {
  const selected = questions.filter(q => q.selected);
  const result: { section: Section; questions: Question[] }[] = [];
  for (const subject of new Set(selected.map(q => q.subject))) {
    const order = [...orders[subject], ...questionTypes.filter(type => !orders[subject].includes(type))];
    const groups = new Map<string, { title: string; questions: Question[] }>();
    for (const q of selected.filter(q => q.subject === subject)) {
      const { key, title } = category(q);
      if (!groups.has(key)) groups.set(key, { title, questions: [] });
      groups.get(key)!.questions.push(q);
    }
    const rank = (key: string) => key === 'dictation-zh-en' ? 0 : key === 'dictation-en-zh' ? 1 : 2;
    const sorted = [...groups].sort(([a, x], [b, y]) => order.indexOf(x.questions[0].type) - order.indexOf(y.questions[0].type) || rank(a) - rank(b));
    sorted.forEach(([key, group], index) => result.push({
      section: { id: `${subject}-${key}`, subject, type: group.questions[0].type, title: group.title, number: index + 1, count: group.questions.length },
      questions: group.questions
    }));
  }
  return result;
}
