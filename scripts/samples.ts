import { resolve, join, relative } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, writeFixtureAssets } from './fixtures.ts';
import { createTask } from './model.ts';
import { generate } from './generate.ts';
const base = resolve(process.argv[2] || 'output/samples');
await mkdir(base,{recursive:true});
const results=[];
for(const subject of ['math','chinese','english'] as const) for(const paper of ['A4','A3'] as const){
  const directory=join(base,`${subject}-${paper}`);
  await writeFixtureAssets(directory); await createTask(directory,fixture(subject,paper));
  const result=await generate({task:directory,answers:true}); results.push(result);
  console.log(`${subject} ${paper}: ${result.student!.layout.questions} 题 / ${result.student!.layout.pages} 页 / ${result.durationMs} ms`);
}
await writeFile(join(base,'manifest.json'),JSON.stringify(results,null,2));
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const link=(path:string)=>esc(relative(base,path).replaceAll('\\','/'));
await writeFile(join(base,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三科打印样张</title><style>body{font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px 28px;color:#191919;background:white}h1{font-size:24px;line-height:32px;margin:0 0 12px}p{color:#666;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:10px}article{border:1px solid #e7e7e7;border-radius:8px;padding:12px}h2{font-size:16px;margin:0 0 12px}a{display:inline-flex;align-items:center;min-height:32px;padding:0 8px;border:1px solid #dcdcdc;border-radius:6px;text-decoration:none;color:#087c40;margin:0 4px 8px 0}a:focus-visible{outline:2px solid #07c05f;outline-offset:3px}details{margin-top:8px}summary{cursor:pointer}img{width:100%;display:block;border:1px solid #e7e7e7;margin-top:10px}@media(max-width:500px){body{padding:16px 12px}}</style><h1>三科打印样张</h1><p>每套 20 题。选择对应纸型，按实际大小 100% 打印。样例为原创合成题型材料。</p><div class="grid">${results.map(r=>`<article><h2>${esc(r.student!.html.includes('数学')?'数学':r.student!.html.includes('语文')?'语文':'英语')} · ${r.paperSize}</h2><p>${r.student!.layout.questions} 题 · ${r.student!.layout.pages} 页 · ${r.student!.layout.fontPt} pt</p><a href="${link(r.student!.html)}">打开预览</a><a href="${link(r.student!.pdf!)}">学生 PDF</a><a href="${link(r.answers!.pdf!)}">答案册</a><details><summary>查看全部页面缩略图</summary>${r.student!.thumbnails.map((p,i)=>`<img loading="lazy" src="${link(join(r.directory,p))}" alt="第 ${i+1} 页预览">`).join('')}</details></article>`).join('')}</div></html>`);
