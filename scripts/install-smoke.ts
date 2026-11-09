import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const isolated=await mkdtemp(join(tmpdir(),'mistake-workbook-install-'));
execFileSync('unzip',['-q',join(root,'dist/mistake-workbook.zip'),'-d',isolated]);
const skill=join(isolated,'mistake-workbook');const task=join(isolated,'work');
// Offline install proves the lockfile/package are sufficient without a sibling checkout.
execFileSync('npm',['ci','--offline','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:skill,stdio:'pipe'});
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
const report={status:'passed',pathBase:'temporary-install-root',doctor,questions:6,paper:'A4',preview:reportPath(preview.student.html),pdf:reportPath(exported.student.pdf),answers:reportPath(exported.answers.pdf),missingFontFailureAndRetry:fontFailure};
await mkdir(join(root,'output'),{recursive:true});await writeFile(join(root,'output/install-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
