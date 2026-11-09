import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const FONT_SHA256 = '06f2b103c174d580ba48c69fc7dcbb63b002cce5ce82ea15a05ad0baa4d2ec5a';
// Immutable source: the same complete font included in the full distribution.
export const FONT_URL = 'https://raw.githubusercontent.com/cabbage2000-lab/mistake-workbook/f11eaa945392f7ebe008ec8e5010e3beea1ac9ef/assets/fonts/NotoSansSC.woff2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maxBytes = 16_000_000;
const valid = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex') === FONT_SHA256;
const exec = promisify(execFile);
const fetchFont: typeof fetch = async (url, options) => {
  // Node 22 fetch does not automatically honor proxy environment variables.
  const proxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(key => process.env[key]);
  if (!proxy) return fetch(url, options);
  const { stdout } = await exec('curl', ['--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '120', '--max-filesize', String(maxBytes), String(url)], { encoding: 'buffer', maxBuffer: maxBytes, timeout: 125_000 });
  return new Response(new Uint8Array(stdout));
};

export async function setupFont(skillRoot = root, fetcher: typeof fetch = fetchFont) {
  const destination = join(skillRoot, 'assets/fonts/NotoSansSC.woff2');
  let existing: Buffer | undefined;
  try { existing = await readFile(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing) {
    if (!valid(existing)) throw new Error('NotoSansSC.woff2 校验失败，请从完整包恢复字体，或移走损坏文件后重试 npm run setup:font');
    return { status: 'ready', downloaded: false, sha256: FONT_SHA256 };
  }

  const response = await fetcher(FONT_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`字体下载失败：HTTP ${response.status}`);
  const chunks: Buffer[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('字体下载超过大小限制');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!valid(bytes)) throw new Error('字体下载 SHA-256 校验失败，未安装文件');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return { status: 'ready', downloaded: true, sha256: FONT_SHA256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupFont().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(`${error.message}\n请检查网络后重试 npm run setup:font，或从完整包复制 assets/fonts/NotoSansSC.woff2。`);
    process.exitCode = 1;
  });
}
