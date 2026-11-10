import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageSkill } from '../scripts/package.ts';

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
  assert.match(read('SKILL.md'), /^display_name: /m);
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
});
