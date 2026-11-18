import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageSkill, validateSkillResources } from '../scripts/package.ts';
import { FONT_SHA256, FONT_URL } from '../scripts/setup-font.ts';

test('打包阻止 SKILL.md 引用缺失的内置资源，允许声明外部下载', () => {
  const font = 'assets/fonts/NotoSansSC.woff2';
  for (const reference of [`从完整包复制 \`${font}\``, `[中文字体](${font})`]) {
    assert.throws(() => validateSkillResources(reference, ['SKILL.md']), /内置资源未打包：assets\/fonts\/NotoSansSC\.woff2/);
    assert.doesNotThrow(() => validateSkillResources(reference, ['SKILL.md', font]));
  }
  assert.throws(() => validateSkillResources('[初始化脚本](scripts/setup-font.ts)', ['SKILL.md']), /scripts\/setup-font\.ts/);
  assert.doesNotThrow(() => validateSkillResources(`[下载字体](${FONT_URL}) [许可](./assets/OFL.txt#license)`, ['assets/OFL.txt']));
});

test('WorkBuddy ZIP 满足两级目录限制，保留运行资源和许可', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbook-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await packageSkill(join(dir, 'workbuddy.zip'), 'workbuddy');
  const entries = execFileSync('unzip', ['-Z1', result.path], { encoding: 'utf8' }).trim().split('\n');
  for (const entry of entries) {
    assert.ok(entry.startsWith('mistake-workbook/'), entry);
    assert.ok(entry.split('/').length <= 3, `目录层级超限：${entry}`);
  }
  for (const path of ['SKILL.md', 'package.json', 'package-lock.json', 'scripts/cli.ts', 'scripts/setup-font.ts', 'assets/worksheet.ts', 'assets/print.css', 'assets/OFL.txt', 'references/protocol.md', 'examples/task.json']) {
    assert.ok(entries.includes(`mistake-workbook/${path}`), `缺少 ${path}`);
  }
  assert.ok(!entries.some(path => /\/assets\/fonts\/|\/tests\/fixtures\/|\/doc\/evidence\//.test(path)));
  const read = (path: string) => execFileSync('unzip', ['-p', result.path, `mistake-workbook/${path}`], { encoding: 'utf8' });
  const skill = read('SKILL.md');
  assert.match(skill, /^display_name: /m);
  assert.match(skill, /外部运行依赖/);
  assert.match(skill, /npm run setup:font/);
  assert.ok(skill.includes(`](${FONT_URL})`));
  assert.ok(skill.includes(FONT_SHA256));
  assert.match(skill, /\[字体初始化脚本\]\(scripts\/setup-font\.ts\)/);
  assert.doesNotMatch(skill, /`assets\/fonts\/NotoSansSC\.woff2`/);
  for (const [, reference] of skill.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('#')) continue;
    assert.ok(entries.includes(`mistake-workbook/${reference}`), `SKILL.md 引用缺失资源：${reference}`);
  }
  assert.equal(read('assets/OFL.txt'), await readFile(new URL('../assets/OFL.txt', import.meta.url), 'utf8'));
  assert.match(read('doc/THIRD_PARTY_NOTICES.md'), /\(\.\.\/assets\/OFL\.txt\)/);
  for (const path of ['README.md', 'README.zh-CN.md', 'doc/acceptance.md', 'doc/github-release.md']) {
    assert.doesNotMatch(read(path), /[("'](?:doc\/)?evidence\//);
    assert.match(read(path), /https:\/\/raw\.githubusercontent\.com\/cabbage2000-lab\/mistake-workbook\/main\/doc\/evidence\//);
  }
  const archive = await readFile(result.path);
  assert.ok(archive.length < 3_000_000);
  assert.equal(await readFile(result.checksumPath, 'utf8'), `${createHash('sha256').update(archive).digest('hex')}  workbuddy.zip\n`);
});

test('完整包继续包含中文字体、测试素材和验收证据', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbook-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await packageSkill(join(dir, 'full.zip'));
  const entries = execFileSync('unzip', ['-Z1', result.path], { encoding: 'utf8' }).trim().split('\n');
  for (const path of ['assets/fonts/NotoSansSC.woff2', 'assets/OFL.txt', 'tests/fixtures/source-truth.json', 'doc/evidence/install-smoke.json']) {
    assert.ok(entries.includes(`mistake-workbook/${path}`), `缺少 ${path}`);
  }
  const readme = execFileSync('unzip', ['-p', result.path, 'mistake-workbook/README.md'], { encoding: 'utf8' });
  assert.match(readme, /src="doc\/evidence\//);
  const skill = execFileSync('unzip', ['-p', result.path, 'mistake-workbook/SKILL.md'], { encoding: 'utf8' });
  assert.equal(skill, await readFile(new URL('../SKILL.md', import.meta.url), 'utf8'));
  assert.match(skill, /\[中文字体\]\(assets\/fonts\/NotoSansSC\.woff2\)/);
});
