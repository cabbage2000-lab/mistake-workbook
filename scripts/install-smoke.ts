import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{workbuddy:{type:'boolean'}}});
const target=values.workbuddy?'workbuddy':'full';
const isolated=await mkdtemp(join(tmpdir(),'mistake-workbook-install-'));
const archive=join(root,`dist/mistake-workbook${values.workbuddy?'-workbuddy':''}.zip`);
if(values.workbuddy)assert.ok((await readFile(archive)).length<3_000_000);
execFileSync('unzip',['-q',archive,'-d',isolated]);
const skill=join(isolated,'mistake-workbook');const task=join(isolated,'work');
// Offline install proves the lockfile/package are sufficient without a sibling checkout.
execFileSync('npm',['ci','--offline','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:skill,stdio:'pipe'});
if(values.workbuddy)await assert.rejects(readFile(join(skill,'assets/fonts/NotoSansSC.woff2')), {code:'ENOENT'});
const setup=()=>JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/setup-font.ts'],{cwd:skill,encoding:'utf8'}));
assert.equal(setup().downloaded,!!values.workbuddy);
assert.equal(setup().downloaded,false);
const cli=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','scripts/cli.ts',...args],{cwd:skill,encoding:'utf8'});
const doctor=JSON.parse(cli('doctor','--task',task));assert.equal(doctor.pdf,true);
cli('init','--task',task,'--input',join(skill,'examples/task.json'));
const preview=JSON.parse(cli('preview','--task',task));assert.equal(preview.student.layout.questions,6);assert.ok(preview.student.thumbnails.length);
const exported=JSON.parse(cli('export','--task',task,'--answers'));assert.equal(exported.status,'success');assert.ok(exported.student.pdf);assert.ok(exported.answers.pdf);assert.equal(exported.student.layout.pages,preview.student.layout.pages);
const status=JSON.parse(cli('status','--task',task));assert.equal(status.stage,'export');assert.equal(status.latest.stale,false);
const font=join(skill,'assets/fonts/NotoSansSC.woff2');let fontFailure=false;
await rename(font,`${font}.bak`);
try{cli('export','--task',task);}catch(e){fontFailure=String((e as {stderr?:Buffer}).stderr).includes('NotoSansSC.woff2');}finally{await rename(`${font}.bak`,font);}
assert.equal(fontFailure,true);assert.equal(JSON.parse(await readFile(join(task,'task.json'),'utf8')).questions.length,6);
const retried=JSON.parse(cli('export','--task',task));assert.equal(retried.status,'success');
const reportPath=(path:string)=>relative(isolated,path).replaceAll('\\','/');
const report={status:'passed',target,pathBase:'temporary-install-root',doctor,questions:6,paper:'A4',preview:reportPath(preview.student.html),pdf:reportPath(exported.student.pdf),answers:reportPath(exported.answers.pdf),missingFontFailureAndRetry:fontFailure};
await writeFile(join(isolated,'install-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
