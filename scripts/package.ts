import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const included=['SKILL.md','README.md','README.zh-CN.md','LICENSE','package.json','package-lock.json','tsconfig.json','scripts','assets','references','agents','examples','tests','doc'];
function crc32(data:Buffer):number { let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
async function files(path:string):Promise<string[]>{const entries=await readdir(join(root,path),{withFileTypes:true});return (await Promise.all(entries.filter(e=>!e.name.startsWith('.')&&!e.name.endsWith('.tmp')&&!e.name.endsWith('.log')).map(e=>e.isDirectory()?files(join(path,e.name)):e.isFile()?[join(path,e.name)]:[]))).flat();}
export async function packageSkill(destination?:string, target:'full'|'workbuddy'='full'){
  destination ??= join(root,`dist/mistake-workbook${target==='workbuddy'?'-workbuddy':''}.zip`);
  const all:string[]=[];for(const p of included){if((await stat(join(root,p))).isFile())all.push(p);else all.push(...await files(p));}
  const fontIndex=all.indexOf(join('assets','fonts','NotoSansSC.woff2'));
  if(target==='workbuddy'&&fontIndex>=0)all.splice(fontIndex,1);
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const parts:Buffer[]=[];const central:Buffer[]=[];let offset=0;
  for(const path of all.sort()){
    let bytes=await readFile(join(root,path));
    if(target==='workbuddy'&&path==='SKILL.md'){
      const metadata={display_name:'错题打印助手',display_name_en:'Mistake Workbook',description_zh:'将数学、语文、英语错题整理为可打印的 A3/A4 练习、学生 PDF 与独立答案册。',description_en:'Turn math, Chinese, and English mistakes into printable A3/A4 practice sheets, student PDFs, and separate answer booklets.',version:manifest.version,author:'cabbage2000-lab'};
      bytes=Buffer.from(bytes.toString('utf8').replace(/^---\r?\n/,`---\n${Object.entries(metadata).map(([key,value])=>`${key}: ${JSON.stringify(value)}\n`).join('')}`));
    }
    const compressed=deflateRawSync(bytes);const name=Buffer.from(`mistake-workbook/${path.replaceAll('\\','/')}`);const crc=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    parts.push(header,name,compressed);central.push(entry,name);offset+=header.length+name.length+compressed.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(all.length,8);end.writeUInt16LE(all.length,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  const archive=Buffer.concat([...parts,...central,end]);
  if(target==='workbuddy'&&archive.length>=3_000_000)throw new Error(`WorkBuddy 上传包必须小于 3 MB，当前 ${archive.length} bytes`);
  const checksum=createHash('sha256').update(archive).digest('hex');
  const checksumPath=`${destination}.sha256`;
  await mkdir(dirname(destination),{recursive:true});await writeFile(destination,archive);
  await writeFile(checksumPath,`${checksum}  ${basename(destination)}\n`);
  return {path:destination,target,bytes:archive.length,files:all.length,checksumPath,sha256:checksum};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{workbuddy:{type:'boolean'}}});
  if(positionals.length>1)throw new Error('只接受一个输出路径');
  console.log(await packageSkill(positionals[0]&&resolve(positionals[0]),values.workbuddy?'workbuddy':'full'));
}
