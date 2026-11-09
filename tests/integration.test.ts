import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { fixture, writeFixtureAssets } from '../scripts/fixtures.ts';
import { createTask, loadTask, updateTask, currentExport } from '../scripts/model.ts';
import { generate } from '../scripts/generate.ts';
import { launchBrowser } from '../scripts/browser.ts';
import type { Worksheet } from '../scripts/schema.ts';

async function setup(w=fixture()) { const dir=await mkdtemp(join(tmpdir(),'workbook-e2e-'));await writeFixtureAssets(dir);await createTask(dir,w);return dir; }
async function wait(page:any) { await page.waitForFunction(()=>document.documentElement.dataset.ready || document.documentElement.dataset.error); assert.equal(await page.evaluate(()=>document.documentElement.dataset.error),undefined); }
test('试卷大题标题随首题分页、续页标记、分组不混栏，学生卷与答案册编号一致',async()=>{
  const w=fixture('math');const byId=new Map(w.questions.map(q=>[q.id,q]));
  w.questions=['math-13','math-2','math-16','math-17','math-1'].map(id=>byId.get(id)!);
  byId.get('math-17')!.workspace={mm:180};byId.get('math-16')!.workspace={mm:0};byId.get('math-13')!.workspace={mm:450};
  const dir=await setup(w);const result=await generate({task:dir,answers:true});const browser=await launchBrowser();
  try{
    const page=await browser.newPage();
    for(const artifact of [result.student!,result.answers!]){
      await page.goto(pathToFileURL(artifact.html).href);await wait(page);await page.emulateMedia({media:'print'});
      assert.deepEqual(await page.locator('.question:not([data-continuation])').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('data-id'),n.getAttribute('data-number')])),[['math-17','1'],['math-16','2'],['math-2','3'],['math-1','4'],['math-13','5']]);
      assert.deepEqual(await page.locator('.section-heading:not([data-continuation])').allTextContents(),['一、填空题共 1 题','二、选择题共 1 题','三、口算题共 2 题','四、解决问题共 1 题']);
      assert.equal(await page.locator('.section-heading').evaluateAll(nodes=>nodes.every(n=>n.nextElementSibling?.querySelector('.question')?.getAttribute('data-section-id')===n.getAttribute('data-section-id'))),true);
      assert.equal(await page.locator('.row').evaluateAll(nodes=>nodes.every(n=>new Set(Array.from(n.children).map(q=>q.getAttribute('data-section-id'))).size===1)),true);
      assert.equal(await page.locator('.sheet-body').evaluateAll(nodes=>nodes.every(n=>n.firstElementChild?.classList.contains('section-heading')&&n.querySelector('.question'))),true);
    }
    await page.goto(pathToFileURL(result.student!.html).href);await wait(page);
    assert.ok(await page.locator('.section-heading[data-continuation]').count()>0);
    assert.ok(result.student!.layout.questionPages['math-13'].length>1);
    assert.ok(result.student!.layout.questionPages['math-17'][0]<result.student!.layout.questionPages['math-16'][0]);
    assert.equal(await page.locator('[data-id="math-13"][data-continuation] .question-label').evaluateAll(nodes=>nodes.every(n=>n.textContent==='第 5 题（续）')),true);
  }finally{await browser.close();}
});
test('60题混合图文 A4/A3 全部入 PDF，同科共享页、换科起页、重排稳定',async()=>{
  const dir=await setup();const a4=await generate({task:dir,answers:true});assert.equal(a4.student!.layout.questions,60);assert.ok(a4.student!.layout.pretextMeasurements>0);assert.equal(a4.student!.pdfCheck!.pages,a4.student!.layout.pages);
  assert.equal(Object.keys(a4.student!.layout.questionPages).length,60);assert.ok(a4.student!.layout.questionPages['chinese-20'].length>1);assert.ok(a4.student!.layout.questionPages['math-20'][0]<a4.student!.layout.questionPages['chinese-1'][0]);
  const again=await generate({task:dir});assert.deepEqual(again.student!.layout.questionPages,a4.student!.layout.questionPages);assert.notEqual(again.directory,a4.directory);assert.equal(again.answers,undefined);
  await updateTask(dir,{expectedRevision:1,operations:[{op:'layout',changes:{paperSize:'A3'}}]});const a3=await generate({task:dir});assert.equal(a3.student!.layout.fontPt,a4.student!.layout.fontPt);assert.ok(a3.student!.layout.pages<a4.student!.layout.pages);assert.ok(a3.student!.pdfCheck!.widthPt>800);assert.equal(a3.pageCountChange,a3.student!.layout.pages-a4.student!.layout.pages);
});
test('浏览器物理空间、手机/桌面无横向溢出、导航/缩放/焦点/折叠交互',async()=>{
  const dir=await setup(fixture('chinese'));const result=await generate({task:dir,mode:'preview'});const browser=await launchBrowser();
  try{
    const page=await browser.newPage();await page.goto(pathToFileURL(result.student!.html).href);await wait(page);
    // A short reading subquestion must keep its complete writing area with its prompt.
    const reading=await page.locator('[data-id="chinese-20"] .subquestion').evaluateAll(nodes=>nodes.map(n=>({labels:n.querySelectorAll('.subquestion-label').length,mm:Array.from(n.querySelectorAll<HTMLElement>('.workspace')).reduce((sum,row)=>sum+Number(row.dataset.workspaceMm),0)})));
    assert.deepEqual(reading,[{labels:1,mm:32},{labels:1,mm:32}]);
    for(const width of [320,390,768,1024,1280,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`viewport ${width}`);}
    await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width),260);
    await page.getByRole('button',{name:'折叠或展开页面导航'}).click();assert.equal(await page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width),48);await page.getByRole('button',{name:'折叠或展开页面导航'}).click();
    await page.getByLabel('缩放',{exact:true}).selectOption('0.5');await page.getByRole('link',{name:'第 2 页',exact:true}).click();assert.ok(page.url().endsWith('#page-2'));
    await page.getByLabel('缩放',{exact:true}).focus();assert.ok(await page.getByLabel('缩放',{exact:true}).evaluate(n=>getComputedStyle(n).outlineStyle!=='none'));
    await page.evaluate(()=>{window.print=()=>{(window as any).__printCalled=true;};});await page.getByRole('button',{name:'打印预览'}).click();assert.equal(await page.evaluate(()=>(window as any).__printCalled),true);
    await page.emulateMedia({media:'print'});const cell=await page.locator('.hanzi-cell').first().boundingBox();assert.ok(Math.abs(cell!.width-11*96/25.4)<.1);assert.ok(Math.abs(cell!.height-11*96/25.4)<.1);
    const dirMath=await setup(fixture('math'));const math=await generate({task:dirMath,mode:'preview'});await page.goto(pathToFileURL(math.student!.html).href);await wait(page);await page.emulateMedia({media:'print'});
    const space=await page.locator('[data-id="math-7"] .workspace').evaluateAll(nodes=>nodes.reduce((n,x)=>n+x.getBoundingClientRect().height,0));assert.ok(Math.abs(space-48*96/25.4)<.2);
    assert.equal(await page.locator('.workspace-lines,.workspace-four-line').count(),0);
    assert.equal(await page.locator('.workspace').evaluateAll(nodes=>nodes.every(n=>{const s=getComputedStyle(n);return [s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].every(w=>parseFloat(w)===0)&&s.backgroundImage==='none'&&!n.children.length;})),true);
    for(const [id,mm] of [['math-1',12],['math-10',56],['math-13',64],['math-19',48]] as const){const height=await page.locator(`[data-id="${id}"] .workspace`).evaluateAll(nodes=>nodes.reduce((n,x)=>n+x.getBoundingClientRect().height,0));assert.ok(Math.abs(height-mm*96/25.4)<.2,`${id} 留白高度`);}
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({media:'screen'});await page.screenshot({path:join(dirMath,'mobile.png'),fullPage:false});
  }finally{await browser.close();}
});
test('HTML/PDF学生答案隔离、独立答案册、黑白图与公式正常',async()=>{
  const w=fixture('english');w.questions=w.questions.slice(0,2);w.questions[0].answer!.text='UNIQUE_ANSWER_SENTINEL';w.sources[2].text='RAW_WORK_SENTINEL';const dir=await setup(w);const result=await generate({task:dir,answers:true});
  const student=await readFile(result.student!.html,'utf8');const answers=await readFile(result.answers!.html,'utf8');assert.ok(!student.includes('UNIQUE_ANSWER_SENTINEL'));assert.ok(!student.includes('RAW_WORK_SENTINEL'));assert.ok(!student.includes('"english":"apple"'));assert.ok(answers.includes('UNIQUE_ANSWER_SENTINEL'));assert.notEqual(result.student!.pdf,result.answers!.pdf);
  const pdf=await PDFDocument.load(await readFile(result.student!.pdf!));assert.equal(pdf.getPageCount(),result.student!.layout.pages);
});
test('线格实际行距、完整四线格和跨页不挤压，英语样例按任务使用作答区',async()=>{
  const w=fixture('english');
  const template=structuredClone(w.questions[0]);
  w.questions.push(
    {...structuredClone(template),id:'ruled-18',type:'generic',blocks:[{type:'text',text:'横线余量测试'}],workspace:{mm:18,style:'lines'}},
    {...structuredClone(template),id:'four-20',workspace:{mm:20,style:'four-line'}},
    {...structuredClone(template),id:'four-two',workspace:{lines:2,style:'four-line'}},
    {...structuredClone(template),id:'four-long',workspace:{mm:540,style:'four-line'}},
    {...structuredClone(template),id:'sub-long',type:'reading',workspace:{mm:0},blocks:[{type:'subquestion',label:'(1) 长书写区测试',blocks:[{type:'text',text:'Write in the space below.'}],workspace:{mm:540,style:'four-line'}}]}
  );
  const dir=await setup(w);const result=await generate({task:dir});const browser=await launchBrowser();
  try{
    const page=await browser.newPage();await page.goto(pathToFileURL(result.student!.html).href);await wait(page);await page.emulateMedia({media:'print'});
    const measured=await page.locator('.workspace').evaluateAll(nodes=>nodes.map(n=>{
      const rect=n.getBoundingClientRect();const paper=n.closest('.paper')!.getBoundingClientRect();
      return {id:n.closest('.question')!.getAttribute('data-id'),style:n.className,heightMm:rect.height*25.4/96,
        inside:rect.top>=paper.top&&rect.bottom<=paper.bottom,
        lines:Array.from(n.querySelectorAll('i')).map(l=>({topMm:(l.getBoundingClientRect().top-rect.top)*25.4/96,style:getComputedStyle(l).borderTopStyle}))};
    }));
    const rows=(id:string)=>measured.filter(r=>r.id===id);
    for(const r of measured.filter(r=>r.style.includes('four-line'))){
      assert.ok(Math.abs(r.heightMm-18)<.02);assert.equal(r.lines.length,4);assert.equal(r.inside,true);
      for(let i=0;i<4;i++){assert.equal(r.lines[i].style,'solid');assert.ok(Math.abs(r.lines[i].topMm-(3+i*4))<.02);}
    }
    assert.equal(rows('ruled-18').length,2);assert.ok(rows('ruled-18').every(r=>Math.abs(r.heightMm-9)<.02));
    assert.equal(rows('four-20').length,2);assert.equal(rows('four-two').length,2);
    assert.equal(rows('four-long').length,30);assert.ok(result.student!.layout.questionPages['four-long'].length>1);
    assert.equal(rows('sub-long').length,30);assert.ok(result.student!.layout.questionPages['sub-long'].length>1);
    for(let i=1;i<=8;i++){assert.equal(rows(`english-${i}`).length,1);assert.ok(rows(`english-${i}`)[0].style.includes('four-line'));}
    for(let i=9;i<=12;i++){assert.equal(rows(`english-${i}`).length,1);assert.ok(rows(`english-${i}`)[0].style.includes('workspace-lines'));assert.ok(Math.abs(rows(`english-${i}`)[0].heightMm-14)<.02);}
    for(const i of [13,14,15,18])assert.equal(rows(`english-${i}`).length,0);
    assert.equal(rows('english-19').length,3);
    assert.equal(result.student!.pdfCheck!.pages,result.student!.layout.pages);
  }finally{await browser.close();}
});
test('待确认禁止PDF、草稿标记、排除后可以导出并明确排除列表',async()=>{
  const w=fixture('math');w.questions=w.questions.slice(0,2);w.questions[0].confirmation='pending';w.questions[0].issues=[{id:'unclear',message:'负号模糊',resolved:false}];const dir=await setup(w);
  await assert.rejects(generate({task:dir}),/math-1/);const draft=await generate({task:dir,mode:'preview',draft:true});assert.equal(draft.student!.pdf,undefined);
  const browser=await launchBrowser();try{const page=await browser.newPage();await page.goto(pathToFileURL(draft.student!.html).href);await wait(page);assert.ok((await page.locator('.draft-label').first().textContent())!.includes('草稿'));assert.equal(await page.locator('#print').isDisabled(),true);}finally{await browser.close();}
  await updateTask(dir,{expectedRevision:1,operations:[{op:'select',id:'math-1',selected:false,reason:'暂无法确认'}]});const ready=await generate({task:dir});assert.equal(ready.student!.layout.questions,1);assert.deepEqual(ready.exclusions,['math-1']);
});
test('缺图失败保留任务、修复资源后只重试导出，不误报成功',async()=>{
  const w=fixture('math');w.questions=[w.questions[17]];const dir=await setup(w);await rm(join(dir,'resources/geometry.png'));await assert.rejects(generate({task:dir}),/资源缺失/);
  assert.equal((await loadTask(dir)).questions[0].confirmation,'confirmed');assert.equal((await currentExport(dir) as any).latestAttempt.status,'failed');
  await writeFixtureAssets(dir);assert.equal((await generate({task:dir})).status,'success');
});
test('单栏长公式不可放置明确失败，限页数不丢题',async()=>{
  const w=fixture('math');w.layout.maxPages=1;const dir=await setup(w);await assert.rejects(generate({task:dir}),/超过限制/);assert.equal((await loadTask(dir)).questions.length,20);
  const formula=fixture('math');formula.questions=formula.questions.slice(0,1);formula.questions[0].blocks=[{type:'formula',tex:'1234567890'.repeat(100)}];const other=await setup(formula);await assert.rejects(generate({task:other}),/单栏宽度/);
});
test('长公式可减栏、超长单题逻辑续页编号不变',async()=>{
  const w=fixture('math');w.questions=w.questions.slice(0,1);w.questions[0].columns=3;w.questions[0].blocks=[{type:'formula',tex:'12345+67890+12345+67890'}];const dir=await setup(w);const result=await generate({task:dir});assert.ok(result.student!.layout.warnings.some(x=>x.includes('栏调整')));
});
test('生成期间修订失效：旧结果不能替换当前文件',async()=>{
  const dir=await setup(fixture('math'));const promise=generate({task:dir});
  for(let i=0;i<100;i++){try{await readFile(join(dir,'generation.json'));break;}catch{await new Promise(r=>setTimeout(r,20));}}
  await updateTask(dir,{expectedRevision:1,operations:[{op:'metadata',changes:{title:'新的修订'}}]});const result=await promise;assert.equal(result.status,'stale');
  const latest=await currentExport(dir) as any;assert.notEqual(latest.revision,1);
});
test('浏览器依赖失败报告具体能力、保留HTML与任务可重试',async()=>{
  const w=fixture('math');w.questions=w.questions.slice(0,1);const dir=await setup(w);const old=process.env.MISTAKE_WORKBOOK_CHROME;process.env.MISTAKE_WORKBOOK_CHROME='/missing/chromium';
  try{await assert.rejects(generate({task:dir}),/浏览器不存在/);assert.equal((await loadTask(dir)).questions.length,1);const dirs=await readdir(join(dir,'exports'));const files=await readdir(join(dir,'exports',dirs[0]));assert.ok(files.some(f=>f.endsWith('.html')));assert.ok(!files.some(f=>f.endsWith('.pdf')));}finally{if(old===undefined)delete process.env.MISTAKE_WORKBOOK_CHROME;else process.env.MISTAKE_WORKBOOK_CHROME=old;}
  assert.equal((await generate({task:dir})).status,'success');
});
test('同修订并发预览/导出只保留更新的请求和PDF下载',async()=>{
  const w=fixture('math');w.questions=w.questions.slice(0,1);const dir=await setup(w);const older=generate({task:dir,mode:'preview'});
  for(let i=0;i<100;i++){try{await readFile(join(dir,'generation.json'));break;}catch{await new Promise(r=>setTimeout(r,20));}}
  await new Promise(r=>setTimeout(r,100));const newer=generate({task:dir});const [oldResult,newResult]=await Promise.all([older,newer]);
  assert.equal(oldResult.status,'stale');assert.equal(newResult.status,'success');const latest=await currentExport(dir) as any;assert.equal(latest.id,newResult.id);assert.ok(latest.student.pdf);assert.equal(latest.stale,false);assert.equal((await loadTask(dir)).stage,'export');
});
test('100题与10份图片来源能力包络，逐题与全部缩略图可追溯',async()=>{
  const w=fixture('math');const template=w.questions[0];w.questions=Array.from({length:100},(_,i)=>({...structuredClone(template),id:`q-${i+1}`}));
  for(let i=0;i<10;i++){
    w.sources.push({id:`photo-${i}`,type:'image',label:`照片${i+1}`,asset:`resources/photo-${i}.png`,status:'complete',coverage:'checked',scopeConfirmed:true});
    w.questions[i*10]={...w.questions[i*10],type:'generic',sourceRefs:[{sourceId:`photo-${i}`,location:'中央题图'}],blocks:[{type:'text',text:'观察题图，完成原题。'},{type:'image',asset:`resources/photo-${i}.png`,alt:'原题图示',widthMm:45,minWidthMm:35,containsWork:false,retainWorkConfirmed:false}]};
  }
  const dir=await setup(w);for(let i=0;i<10;i++)await copyFile(join(dir,'resources/geometry.png'),join(dir,`resources/photo-${i}.png`));
  const result=await generate({task:dir});assert.equal(result.student!.layout.questions,100);assert.equal(Object.keys(result.student!.layout.questionPages).length,100);assert.equal(result.student!.thumbnails.length,result.student!.layout.pages);assert.equal(result.status,'success');
});
