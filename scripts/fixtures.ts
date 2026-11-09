import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWorksheet, today, type Worksheet, type Question } from './schema.ts';

export function fixture(subject?: 'math' | 'chinese' | 'english', paperSize: 'A3' | 'A4' = 'A4'): Worksheet {
  const sources = [
    { id: 'S1', type: 'text', label: '数学原始文本', status: 'complete', coverage: 'checked', scopeConfirmed: true, candidateCount: 20 },
    { id: 'S2', type: 'text', label: '语文原始文本', status: 'complete', coverage: 'checked', scopeConfirmed: true, candidateCount: 20 },
    { id: 'S3', type: 'text', label: '英语原始文本', status: 'complete', coverage: 'checked', scopeConfirmed: true, candidateCount: 20 },
    { id: 'S4', type: 'image', label: '几何题截图', asset: 'resources/geometry.png', status: 'complete', coverage: 'checked', scopeConfirmed: true },
    { id: 'S5', type: 'image', label: '关联统计图照片', asset: 'resources/chart.png', status: 'complete', coverage: 'checked', scopeConfirmed: true }
  ];
  const qs: any[] = [];
  const add = (subject: string, type: string, blocks: unknown[], extra: object = {}) => { const index = qs.filter(q => q.subject === subject).length + 1; qs.push({ id: `${subject}-${index}`, subject, type, sourceRefs: [{ sourceId: subject === 'math' ? 'S1' : subject === 'chinese' ? 'S2' : 'S3', location: `第 ${index} 题`, originalNumber: String(index) }], blocks, confirmation: 'confirmed', ...extra }); };
  for (const expr of ['28 + 37', '90 − 46', '7 × 8', '64 ÷ 8', '3.6 + 0.45', '2.5 × 4']) add('math', 'oral', [{ type: 'text', text: `${expr} = ______` }], { answer: { text: String([65,44,56,8,4.05,10][qs.length]), verified: true, provenance: '确定性计算器', expression: expr } });
  for (const expr of ['367 + 458', '802 − 376', '24 × 16']) add('math', 'vertical', [{ type: 'text', text: `用竖式计算：${expr}` }]);
  for (const expr of ['(125 + 75) ÷ 8', '36 × 5 − 84 ÷ 7', '72 ÷ (3 × 4)']) add('math', 'mixed', [{ type: 'text', text: `计算：${expr}` }]);
  for (const text of ['图书角原有 48 本书，又买来 26 本，借出 19 本。现在有多少本书？', '一辆汽车每小时行驶 65 千米，3 小时后距离目的地还有 45 千米。全程多少千米？', '一根绳子长 8 米，用去 2.75 米，又用去 1.8 米。还剩多少米？']) add('math', 'application', [{ type: 'text', text }]);
  add('math', 'choice', [{ type: 'text', text: '下列各数中，最接近 1 的是（　）。' }, { type: 'options', items: ['A. 0.89', 'B. 1.02', 'C. 1.10'] }]);
  add('math', 'fill', [{ type: 'text', text: '在横线上填写合适的数。' }, { type: 'formula', tex: '\\frac{1}{2}+\\frac{1}{4}=\\underline{\\qquad}' }]);
  add('math', 'application', [{ type: 'text', text: '下图每个小方格的边长为 1 厘米，求三角形的面积。' }, { type: 'image', asset: 'resources/geometry.png', alt: '底 6 格、高 4 格的直角三角形', widthMm: 70, minWidthMm: 50 }], { sourceRefs: [{ sourceId: 'S4', location: '图片中央三角形区域' }] });
  add('math', 'reading', [{ type: 'text', text: '观察两个小组收集废纸的统计图，完成下列问题。' }, { type: 'image', asset: 'resources/chart.png', alt: '两组统计柱形图，第一组 4 格、第二组 6 格', widthMm: 80 }, { type: 'subquestion', label: '（1）第二组比第一组多收集多少份？', blocks: [{ type: 'text', text: '每格代表 5 份，请列式计算。' }], workspace: { mm: 24 } }, { type: 'subquestion', label: '（2）两组共收集多少份？', blocks: [{ type: 'text', text: '请写出计算过程。' }], workspace: { mm: 24 } }], { sourceRefs: [{ sourceId: 'S5', location: '统计图及下方两小题' }] });
  add('math', 'fill', [{ type: 'text', text: '根据表格填空。' }, { type: 'table', rows: [['物品', '单价（元）', '数量'], ['铅笔', '2', '6'], ['橡皮', '3', '4']] }], { workspace: { mm: 24 } });
  for (const [pinyin, word] of [['chūn tiān','春天'],['xué xiào','学校'],['lǜ sè','绿色'],['péng you','朋友'],['kuài lè','快乐'],['cháng jiāng','长江'],['yīn yuè','音乐'],['huā duǒ','花朵']]) add('chinese','pinyin',[{ type:'pinyin',text:pinyin,cells:2 }],{ answer:{text:word,verified:true,provenance:'人工校对的固定样例词表'} });
  for (const word of ['认真','河流','森林','勇敢']) add('chinese','copy',[{type:'copy',word,repeats:3}]);
  for (const [type, text] of [
    ['fill', '选词填空：平静、安静。教室里十分（　）。'],
    ['choice', '给“行”选择正确读音：一行（háng / xíng）大雁飞过。'],
    ['fill', '把句子补充完整：春天来了，________________。'],
    ['generic', '用“因为……所以……”写一句话。'],
    ['judgment', '判断下面的说法是否正确：句号表示一句话说完了。（　）'],
    ['generic', '给下面的句子加标点：你今天去图书馆吗']
  ]) add('chinese',type,[{type:'text',text}],{workspace:{mm:24}});
  add('chinese','reading',[{type:'text',text:'小溪从山间流过。清晨，小鸟在枝头唱歌，孩子们沿着小路走向学校。大家约定保护水源，让小溪一直清澈。'},{type:'subquestion',label:'（1）故事发生在什么时候？',blocks:[{type:'text',text:'请从文中找出有关词语。'}],workspace:{mm:16}},{type:'subquestion',label:'（2）孩子们作出了什么约定？',blocks:[{type:'text',text:'请用一句话回答。'}],workspace:{mm:24}}]);
  add('chinese','reading',[{type:'text',text:'阅读下面的长篇材料。\n'+Array.from({length:30},(_,i)=>`第${i+1}段：周末，小林和同学来到自然公园，观察树叶、记录天气。他们发现不同树木的叶子各有特点，并认真整理了观察笔记。`).join('\n')},{type:'subquestion',label:'（1）同学们记录了哪些内容？',blocks:[{type:'text',text:'结合材料作答。'}],workspace:{mm:32}},{type:'subquestion',label:'（2）你还想观察什么？',blocks:[{type:'text',text:'写出自己的计划。'}],workspace:{mm:32}}]);
  const words=[['苹果','apple'],['学校','school'],['朋友','friend'],['绿色','green'],['星期三','Wednesday'],['家庭','family'],['图书馆','library'],['漂亮的','beautiful'],['踢足球','play football'],['在早上','in the morning'],['照相','take photos'],['一杯水','a glass of water']];
  words.forEach(([chinese,english],i)=>add('english','dictation',[{type:'dictation',chinese,english,direction:i<8?'zh-en':'en-zh'}],{workspace:{style:i<8?'four-line':'lines'},answer:{text:i<8?english:chinese,verified:true,provenance:'人工核对的双语词表'}}));
  add('english','fill',[{type:'text',text:'Fill in: She ____ (go) to school every day.'}],{workspace:{mm:0}});
  add('english','choice',[{type:'text',text:'Choose: There ____ two books on the desk. A. is  B. are'}],{workspace:{mm:0}});
  add('english','fill',[{type:'text',text:'Write the plural form: child → __________'}],{workspace:{mm:0}});
  add('english','generic',[{type:'text',text:'Put in order: you / are / how / ?'}],{workspace:{lines:1,style:'four-line'}});
  add('english','generic',[{type:'text',text:'Translate into Chinese: Please open the window.'}],{workspace:{lines:1,style:'lines'}});
  add('english','fill',[{type:'text',text:'Complete: I like apples, ____ I do not like pears.'}],{workspace:{mm:0}});
  add('english','reading',[{type:'text',text:'Tom has a small garden. He plants flowers with his mother every Sunday. The flowers are red and yellow.'},{type:'subquestion',label:'(1) When does Tom plant flowers?',blocks:[{type:'text',text:'Answer in a complete sentence.'}],workspace:{lines:2,style:'four-line'}},{type:'subquestion',label:'(2) What colours are the flowers?',blocks:[{type:'text',text:'Write your answer.'}],workspace:{lines:1,style:'four-line'}}]);
  add('english','choice',[{type:'text',text:'Which sentence is correct?'},{type:'options',items:['A. He have a book.','B. He has a book.','C. He having a book.']}]);
  return parseWorksheet({id:'acceptance-sample',title:subject?`${{math:'数学',chinese:'语文',english:'英语'}[subject]}错题重做`:'三科错题重做',date:today(),sources,questions:subject?qs.filter(q=>q.subject===subject):qs,layout:{paperSize,paperReason:'explicit'},stage:'layout'});
}
export async function writeFixtureAssets(directory: string) {
  await mkdir(join(directory,'resources'),{recursive:true});
  const grid = Array.from({length:9},(_,i)=>`<path d="M${30+i*40} 30V270 M30 ${30+i*30}H350" stroke="#bbb"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="320"><rect width="400" height="320" fill="white"/>${grid}<path d="M70 70V230H310Z" fill="none" stroke="black" stroke-width="4"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(directory,'resources/geometry.png'));
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="white"/><path d="M40 20V260H370" fill="none" stroke="black" stroke-width="3"/><rect x="100" y="140" width="70" height="120" fill="none" stroke="black" stroke-width="3"/><rect x="240" y="80" width="70" height="180" fill="#ccc" stroke="black" stroke-width="3"/></svg>')).png().toFile(join(directory,'resources/chart.png'));
  await sharp(join(directory,'resources/geometry.png')).rotate(7,{background:'white'}).blur(3).jpeg().toFile(join(directory,'resources/blurred-tilted.jpg'));
  await sharp(join(directory,'resources/geometry.png')).composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="320"><path d="M70 90L160 170L280 40" fill="none" stroke="black" stroke-width="8"/></svg>')}]).png().toFile(join(directory,'resources/with-work.png'));
}
