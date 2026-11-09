import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { applyOperations, createTask, loadTask, updateTask, fingerprint, currentExport, newTask, summary } from '../scripts/model.ts';
import { blockers, inferPaper, parseWorksheet, workspace, images } from '../scripts/schema.ts';
import { project, verifiedAnswer } from '../scripts/projection.ts';
import { fixture, writeFixtureAssets } from '../scripts/fixtures.ts';
import { calculate, solve } from '../scripts/arithmetic.ts';
import { importImage } from '../scripts/sources.ts';
import { localResource, generate } from '../scripts/generate.ts';
import { setupFont, FONT_URL } from '../scripts/setup-font.ts';

test('轻量包下载完整字体并校验，重复初始化不联网',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-font-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const font=await readFile(new URL('../assets/fonts/NotoSansSC.woff2',import.meta.url));
  let requests=0;
  const fetcher:typeof fetch=async url=>{assert.equal(url,FONT_URL);requests++;return new Response(new Uint8Array(font));};
  assert.equal((await setupFont(dir,fetcher)).downloaded,true);
  assert.equal((await setupFont(dir,fetcher)).downloaded,false);
  assert.equal(requests,1);
  assert.deepEqual(await readFile(join(dir,'assets/fonts/NotoSansSC.woff2')),font);
});
test('下载失败或字体校验失败不安装坏文件，可重新初始化',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-font-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await assert.rejects(setupFont(dir,async()=>new Response('not found',{status:404})),/HTTP 404/);
  await assert.rejects(setupFont(dir,async()=>new Response('invalid font')),/SHA-256/);
  await assert.rejects(readFile(join(dir,'assets/fonts/NotoSansSC.woff2')),{code:'ENOENT'});
  const font=await readFile(new URL('../assets/fonts/NotoSansSC.woff2',import.meta.url));
  assert.equal((await setupFont(dir,async()=>new Response(new Uint8Array(font)))).downloaded,true);
});
test('损坏的已有字体明确报错，不隐式联网或覆盖',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-font-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'assets/fonts'),{recursive:true});
  await writeFile(join(dir,'assets/fonts/NotoSansSC.woff2'),'invalid font');
  let requests=0;
  await assert.rejects(setupFont(dir,async()=>{requests++;throw new Error('unexpected network');}),/校验失败/);
  assert.equal(requests,0);
  assert.equal(await readFile(join(dir,'assets/fonts/NotoSansSC.woff2'),'utf8'),'invalid font');
});

function small() { const w=fixture('math'); w.questions=w.questions.slice(0,2); return w; }
function apply(w: ReturnType<typeof small>, operations: any[]) { return applyOperations(w,{expectedRevision:w.revision,operations}); }
test('省略或部分提供布局时补齐默认参数，保持严格校验',()=>{
  const input={id:'minimal-task',title:'默认布局',date:'2026-11-09'};
  const expected={paperSize:'A4',paperReason:'default',preset:'standard',fontPt:14,marginMm:14,columns:'auto',cellMm:11};
  assert.deepEqual(parseWorksheet(input).layout,expected);
  assert.deepEqual(parseWorksheet({...input,layout:{paperSize:'A3'}}).layout,{...expected,paperSize:'A3'});
  assert.throws(()=>parseWorksheet({...input,layout:{fontPt:8}}));
  assert.throws(()=>parseWorksheet({...input,layout:{unexpected:true}}));
});
test('纸型明确选择优先、试卷 A3、普通任务 A4',()=>{
  assert.equal(inferPaper('生成一份试卷').paperSize,'A3'); assert.equal(inferPaper('生成 A4 试卷').paperSize,'A4');
  assert.equal(inferPaper('生成试卷','A4').paperSize,'A4'); assert.equal(inferPaper('整理错题').paperSize,'A4');
  assert.equal(newTask('试卷','生成试卷').layout.paperSize,'A3');
});
test('学科固定样例各20题，总60题',()=>{
  const all=fixture(); assert.equal(all.questions.length,60); for(const s of ['math','chinese','english']) assert.equal(all.questions.filter(q=>q.subject===s).length,20);
});
test('试卷按题型归类，同类保序、排除空组，来源和确认状态不变',()=>{
  const w=fixture('math');
  const byId=new Map(w.questions.map(q=>[q.id,q]));
  w.questions=['math-13','math-2','math-16','math-1','math-17','math-14','math-7'].map(id=>byId.get(id)!);
  w.questions.find(q=>q.id==='math-7')!.selected=false;
  const before=structuredClone(w);const student=project(w,'student');const answers=project(w,'answers');
  assert.deepEqual(student.questions.map(q=>q.id),['math-17','math-16','math-2','math-1','math-13','math-14']);
  assert.deepEqual(student.sections.map(s=>[s.title,s.number,s.count]),[['填空题',1,1],['选择题',2,1],['口算题',3,2],['解决问题',4,2]]);
  assert.deepEqual(student.questions.map(q=>q.number),[1,2,3,4,5,6]);
  assert.deepEqual(summary(w).sections.flatMap(s=>s.questions),student.questions.map(q=>({id:q.id,number:q.number})));
  assert.deepEqual(answers.sections,student.sections);
  assert.deepEqual(answers.questions.map(q=>[q.id,q.number,q.sectionId]),student.questions.map(q=>[q.id,q.number,q.sectionId]));
  assert.deepEqual(w,before);
  const reversed=apply(w,[{op:'reorder',ids:w.questions.map(q=>q.id).reverse()}]);
  assert.deepEqual(project(reversed,'student').questions.map(q=>q.id),['math-17','math-16','math-1','math-2','math-14','math-13']);
  assert.ok(reversed.questions.every(q=>q.confirmation==='confirmed'));
});
test('交错学科合并，双向默写独立分组，阅读材料与子题不拆散',()=>{
  const w=fixture();const byId=new Map(w.questions.map(q=>[q.id,q]));
  w.questions=['english-9','math-13','english-1','chinese-19','math-16','english-10','english-2','english-19'].map(id=>byId.get(id)!);
  const sheet=project(w,'student');
  assert.deepEqual(sheet.questions.map(q=>q.id),['english-1','english-2','english-9','english-10','english-19','math-16','math-13','chinese-19']);
  assert.deepEqual(sheet.sections.map(s=>s.title),['中译英','英译中','阅读理解','选择题','解决问题','阅读理解']);
  assert.equal(sheet.questions.find(q=>q.id==='english-19')!.blocks.filter(b=>b.type==='subquestion').length,2);
  assert.equal(project({...w,questions:[]},'student').sections.length,0);
});
test('重复 ID、悬空来源、未知字段、非法字号被拒绝',()=>{
  const w=small(); assert.throws(()=>parseWorksheet({...w,questions:[w.questions[0],w.questions[0]]}),/ID 重复/);
  const bad=structuredClone(w);bad.questions[0].sourceRefs[0].sourceId='missing';assert.throws(()=>parseWorksheet(bad),/不存在/);
  assert.throws(()=>parseWorksheet({...w,hidden:'secret'}));assert.throws(()=>parseWorksheet({...w,layout:{...w.layout,fontPt:11}}));
});
test('100题边界：101题明确拒绝，不截取',()=>{
  const w=small(); w.questions=Array.from({length:101},(_,i)=>({...w.questions[0],id:`q-${i}`}));assert.throws(()=>parseWorksheet(w),/100 题/);
});
test('只解决指定疑点，未答项保持 pending',()=>{
  let w=small(); w=apply(w,[{op:'addIssue',id:'math-1',issue:{id:'I1',message:'负号待确认'}},{op:'addIssue',id:'math-1',issue:{id:'I2',message:'单位待确认'}}]);
  w=apply(w,[{op:'resolveIssue',id:'math-1',issueId:'I1',resolution:'确认是减号'}]);
  assert.equal(w.questions[0].issues[1].resolved,false);assert.equal(w.questions[0].confirmation,'pending');
  assert.throws(()=>apply(w,[{op:'confirm',id:'math-1'}]),/未解决/);
  w=apply(w,[{op:'resolveIssue',id:'math-1',issueId:'I2',resolution:'单位为米'},{op:'confirm',id:'math-1'}]);assert.equal(w.questions[0].confirmation,'confirmed');
});
test('排除待确认题可继续，恢复后仍阻止导出',()=>{
  let w=small();w.questions[0].confirmation='pending';assert.ok(blockers(w).some(x=>x.includes('math-1')));
  w=apply(w,[{op:'select',id:'math-1',selected:false}]);assert.deepEqual(blockers(w),[]);
  w=apply(w,[{op:'select',id:'math-1',selected:true}]);assert.ok(blockers(w).length);
});
test('题意编辑重置确认与答案核对，布局/排序不重置',()=>{
  let w=small();const old=fingerprint(w);
  w=apply(w,[{op:'layout',changes:{paperSize:'A3',fontPt:16}},{op:'reorder',ids:['math-2','math-1']},{op:'updateQuestion',id:'math-1',changes:{workspace:{mm:40}}}]);
  assert.equal(w.questions[1].confirmation,'confirmed');assert.notEqual(fingerprint(w),old);
  w=apply(w,[{op:'updateQuestion',id:'math-1',changes:{blocks:[{type:'text',text:'28 + 38 = ____'}]}}]);assert.equal(w.questions[1].confirmation,'pending');assert.equal(w.questions[1].answer!.verified,false);
});
test('人工修改、留白、选题在重新识别时全部保留并产生冲突',()=>{
  for(const operation of [{op:'select',id:'math-1',selected:false},{op:'updateQuestion',id:'math-1',changes:{workspace:{mm:96},columns:2}},{op:'updateQuestion',id:'math-1',changes:{blocks:[{type:'text',text:'家长修订'}]}}]){
    let w=small();const proposal=structuredClone(w.questions[0]);w=apply(w,[operation]);const before=structuredClone(w.questions[0]);
    w=apply(w,[{op:'reidentify',sourceId:'S1',questions:[proposal]}]);assert.deepEqual(w.questions[0],before);assert.equal(w.conflicts.length,1);
    w=apply(w,[{op:'resolveConflict',id:w.conflicts[0].id,choice:'keep'}]);assert.deepEqual(w.questions[0],before);
  }
});
test('冲突采用新版后仍需确认',()=>{
  let w=small();w.questions[0].editedByUser=true;w=apply(w,[{op:'reidentify',sourceId:'S1',questions:[{...w.questions[0],blocks:[{type:'text',text:'新版题面'}]}]}]);
  w=apply(w,[{op:'resolveConflict',id:w.conflicts[0].id,choice:'replace'}]);assert.equal(w.questions[0].confirmation,'pending');assert.equal(w.questions[0].version,2);
});
test('合并与拆分可追溯，保持位置并重置确认',()=>{
  let w=small();const merged={...w.questions[0],id:'merged',sourceRefs:w.questions.flatMap(q=>q.sourceRefs),blocks:w.questions.flatMap(q=>q.blocks)};
  w=apply(w,[{op:'merge',ids:['math-1','math-2'],question:merged}]);assert.equal(w.questions.length,1);assert.equal(w.questions[0].confirmation,'pending');
  w=apply(w,[{op:'split',id:'merged',questions:[{...merged,id:'part-1'},{...merged,id:'part-2'}]}]);assert.equal(w.questions.length,2);assert.ok(w.questions.every(q=>q.confirmation==='pending'));
});
test('含旧作答题图独立确认，不与题面确认混淆',()=>{
  let w=fixture('math');w.questions=[w.questions[17]];const img=images(w.questions[0].blocks)[0];img.containsWork=true;
  assert.ok(blockers(w).some(x=>x.includes('含作答')));assert.throws(()=>apply(w,[{op:'confirm',id:w.questions[0].id}]),/作答/);
  w=apply(w,[{op:'retainImageWork',id:w.questions[0].id,asset:img.asset,confirmed:true},{op:'confirm',id:w.questions[0].id}]);assert.deepEqual(blockers(w),[]);
});
test('未经来源范围与覆盖核对不能导出，失败来源不影响独立入选题',()=>{
  const w=small();w.sources[0].coverage='unchecked';assert.ok(blockers(w).some(s=>s.includes('覆盖')));
  w.sources[0].coverage='checked';w.sources.push({id:'unreadable',type:'image',label:'模糊图片',status:'failed',coverage:'unchecked',scopeConfirmed:false,error:'请补充清晰照片'});assert.deepEqual(blockers(w),[]);
});
test('学生投影无参考答案、来源原文、被排除题和默写目标',()=>{
  const w=fixture('english');w.questions=w.questions.slice(0,2);w.sources[2].text='RAW_SOURCE_SECRET';w.questions[0].answer!.text='SECRET_VERIFIED_ANSWER';w.questions[1].selected=false;
  const json=JSON.stringify(project(w,'student'));assert.ok(!json.includes('SECRET_VERIFIED_ANSWER'));assert.ok(!json.includes('RAW_SOURCE_SECRET'));assert.ok(!json.includes('apple'));assert.ok(!json.includes('english-2'));
});
test('独立答案仅核对项，未核对为未提供，错误四则结果拒绝',()=>{
  const w=small();assert.equal(verifiedAnswer(w.questions[0]),'65');w.questions[0].answer!.text='66';assert.throws(()=>verifiedAnswer(w.questions[0]),/不符/);
  w.questions[0].answer!.verified=false;assert.equal(verifiedAnswer(w.questions[0]),'未提供');
});
test('长短语在默认和仅指定线格样式时均扩容，学生字段不含目标',()=>{
  for(const paperSize of ['A4','A3'] as const) for(const preset of ['compact','standard','spacious'] as const) for(const style of [undefined,'lines','four-line'] as const){
    const w=fixture('english',paperSize);w.layout.preset=preset;w.questions=w.questions.slice(0,1);
    w.questions[0].workspace=style?{style}:undefined;
    const short=project(w,'student').questions[0].workspaceMm;
    w.questions[0].blocks=[{type:'dictation',chinese:'请默写长短语',english:'a very long phrase '.repeat(12),direction:'zh-en'}];
    const sheet=project(w,'student');const q=sheet.questions[0];
    assert.ok(q.workspaceMm>short,`${paperSize}/${preset}/${style}`);
    assert.ok(q.workspaceMm>=Math.ceil(228*3.5/((paperSize==='A4'?210:297)-28))*q.workspaceRowMm);
    if(style==='four-line')assert.equal(q.workspaceMm%18,0);
    assert.ok(!JSON.stringify(sheet).includes('a very long phrase'));
  }
});
test('四线格按完整18mm组计算，显式行数与毫米不受预设缩放',()=>{
  for(const preset of ['compact','standard','spacious'] as const){
    assert.equal(workspace({type:'dictation',workspace:{style:'four-line'}},preset).mm,18);
    assert.equal(workspace({type:'dictation',workspace:{mm:20,style:'four-line'}},preset).mm,36);
    assert.equal(workspace({type:'dictation',workspace:{lines:2,style:'four-line'}},preset).mm,36);
    assert.equal(workspace({type:'dictation',workspace:{lines:2,style:'lines'}},preset).mm,28);
    assert.equal(workspace({type:'generic',workspace:{lines:2,style:'lines'}},preset).mm,16);
    assert.equal(workspace({type:'pinyin',workspace:{mm:0,style:'four-line'}},preset).mm,0);
    assert.deepEqual(workspace({type:'application',workspace:{style:'blank'}},preset),workspace({type:'application'},preset));
  }
  const w=fixture('english');w.questions=w.questions.slice(0,1);w.questions[0].workspace={mm:36,style:'four-line'};
  w.questions[0].blocks=[{type:'dictation',chinese:'长短语',english:'long phrase '.repeat(20),direction:'zh-en'}];
  assert.equal(project(w,'student').questions[0].workspaceMm,36);
});
test('英语样例按作答任务选线格：英文四线格、中文横线、题内空格不额外加线',()=>{
  const qs=project(fixture('english'),'student').questions;
  const q=(n:number)=>qs.find(q=>q.id===`english-${n}`)!;
  assert.ok(qs.slice(0,8).every(q=>q.workspaceStyle==='four-line'&&q.workspaceMm===18));
  assert.ok(qs.slice(8,12).every(q=>q.workspaceStyle==='lines'&&q.workspaceMm===14&&q.workspaceRowMm===14));
  for(const i of [13,14,15,18])assert.equal(q(i).workspaceMm,0);
  assert.equal(q(16).workspaceStyle,'four-line');assert.equal(q(16).workspaceMm,18);
  assert.equal(q(17).workspaceStyle,'lines');assert.equal(q(17).workspaceMm,8);
  const sub=q(19).blocks.filter(b=>b.type==='subquestion');
  assert.deepEqual(sub.map(b=>[b.workspaceMm,b.workspaceStyle,b.workspaceRowMm]),[[36,'four-line',18],[18,'four-line',18]]);
  for(const type of ['choice','judgment','fill'] as const)assert.equal(workspace({type,workspace:{mm:0}},'standard').mm,0);
});
test('毫米空间和字格不随字号与纸型缩放，三种预设遵守下限',()=>{
  assert.equal(workspace({type:'vertical'},'standard').mm,48);assert.equal(workspace({type:'mixed'},'standard').mm,56);assert.equal(workspace({type:'application'},'standard').mm,64);
  for(const preset of ['compact','standard','spacious'] as const){assert.ok(workspace({type:'oral'},preset).mm>=12);assert.equal(workspace({type:'application',workspace:{mm:96}},preset).mm,96);}
  const w=fixture('math');const sheet=project(w,'student');const first=sheet.questions.map(q=>q.workspaceMm);w.layout.fontPt=20;w.layout.paperSize='A3';assert.deepEqual(project(w,'student').questions.map(q=>q.workspaceMm),first);
  assert.ok(sheet.questions.every(q=>q.workspaceStyle==='blank'));
  for(const q of sheet.questions)for(const b of q.blocks)if(b.type==='subquestion'){assert.equal(b.workspaceStyle,'blank');assert.equal(b.workspaceMm,24);}
  w.questions[9].workspace={style:'lines'};assert.equal(project(w,'student').questions.find(q=>q.id==='math-10')!.workspaceStyle,'lines');
});
test('精确计算器正确处理负号/小数/分数，拒绝代码与除零',()=>{
  assert.equal(solve('0.1+0.2'),'0.3');assert.equal(solve('1/3+1/6'),'0.5');assert.equal(solve('−3×(2+4)'),'-18');assert.throws(()=>calculate('process.exit()'));assert.throws(()=>calculate('1/0'));
});
test('修订 CAS、原子失败、磁盘恢复、旧文件失效',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-model-'));await createTask(dir,small());
  const original=await readFile(join(dir,'task.json'),'utf8');await assert.rejects(updateTask(dir,{expectedRevision:2,operations:[{op:'layout',changes:{paperSize:'A3'}}]}),/修订冲突/);assert.equal(await readFile(join(dir,'task.json'),'utf8'),original);
  await writeFile(join(dir,'latest.json'),JSON.stringify({fingerprint:fingerprint(await loadTask(dir))}));
  await updateTask(dir,{expectedRevision:1,operations:[{op:'layout',changes:{paperSize:'A3'}}]});assert.equal((await loadTask(dir)).revision,2);assert.equal((await currentExport(dir) as any).stale,true);
  assert.equal(JSON.parse(await readFile(join(dir,'revisions/r0001.json'),'utf8')).layout.paperSize,'A4');
});
test('同修订并发修改只有一次成功，另一操作不能覆盖',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-race-'));await createTask(dir,small());
  const result=await Promise.allSettled([updateTask(dir,{expectedRevision:1,operations:[{op:'metadata',changes:{title:'甲'}}]}),updateTask(dir,{expectedRevision:1,operations:[{op:'metadata',changes:{title:'乙'}}]})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await loadTask(dir)).revision,2);
});
test('不可写保存明确失败，不承诺保存成功',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-write-'));await writeFile(join(dir,'not-directory'),'x');await assert.rejects(createTask(join(dir,'not-directory','child'),small()));
});
test('生成登记遇到写锁明确记录失败，不遗留伪生成状态',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-generation-lock-'));await createTask(dir,small());await writeFile(join(dir,'.task.lock'),'busy');
  await assert.rejects(generate({task:dir}),/另一操作写入/);const dirs=await readdir(join(dir,'exports'));const report=JSON.parse(await readFile(join(dir,'exports',dirs[0],'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal((await loadTask(dir)).revision,1);
});
test('已退出生成进程被识别为中断，可重新生成而非永久处理中',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-interrupted-'));await createTask(dir,small());await writeFile(join(dir,'generation.json'),JSON.stringify({status:'generating',pid:2147483647}));
  const result=await currentExport(dir) as any;assert.equal(result.generating,false);assert.equal(result.latestAttempt.status,'failed');assert.ok(result.latestAttempt.error.includes('重试'));
});
test('资源缺失、外部路径、目录逃逸与软链接拒绝',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-assets-'));await writeFixtureAssets(dir);
  assert.ok((await localResource(dir,'resources/geometry.png')).length>0);
  await assert.rejects(localResource(dir,'resources/missing.png'),/缺失/);await assert.rejects(localResource(dir,'https://example.com/a.png'),/相对/);
  const outside=await mkdtemp(join(tmpdir(),'outside-'));await writeFile(join(outside,'x.png'),'test');await symlink(join(outside,'x.png'),join(dir,'resources/link.png'));await assert.rejects(localResource(dir,'resources/link.png'),/越出/);
});
test('照片原图保存、EXIF方向规范化、旋转裁剪、重读与格式失败',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbook-import-'));await createTask(dir,small());
  const file=join(dir,'phone.jpg');await sharp({create:{width:400,height:300,channels:3,background:'white'}}).jpeg().withMetadata({orientation:6}).toFile(file);
  const src=await importImage(dir,file,{id:'PHOTO'});const meta=await sharp(join(dir,src.asset!)).metadata();assert.equal(meta.width,300);assert.equal(meta.height,400);assert.ok(await readFile(join(dir,src.originalAsset!)));
  const crop=await importImage(dir,file,{id:'CROP',rotate:90,crop:[0,0,100,50]});const cropped=await sharp(join(dir,crop.asset!)).metadata();assert.equal(cropped.width,100);assert.equal(cropped.height,50);
  await assert.rejects(importImage(dir,join(dir,'input.pdf'),{id:'PDF'}),/P0/);
});
