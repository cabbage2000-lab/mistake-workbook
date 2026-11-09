import { chromium, type Browser } from 'playwright';
import { existsSync } from 'node:fs';
export async function launchBrowser(): Promise<Browser> {
  const explicit = process.env.MISTAKE_WORKBOOK_CHROME;
  if (explicit && !existsSync(explicit)) throw new Error('MISTAKE_WORKBOOK_CHROME 指向的浏览器不存在，请重新指定');
  // The bundled Playwright Chromium is the reproducible default; installed Chrome is a fallback.
  const bundled = chromium.executablePath();
  const candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executablePath = explicit || (existsSync(bundled) ? bundled : candidates.find(p => existsSync(p)));
  try { return await chromium.launch({ headless: true, executablePath }); }
  catch (e) { throw new Error('浏览器启动失败。运行 npx playwright install chromium，或设置 MISTAKE_WORKBOOK_CHROME；任务已保留，可单独重试生成。', { cause: e }); }
}
