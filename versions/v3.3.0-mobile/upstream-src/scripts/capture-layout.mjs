import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts/layout', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const rows = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
    const page = await context.newPage();
    for (const route of ['home', 'setup', 'history']) {
      await page.goto(`http://127.0.0.1:5196/#/${route}`);
      await page.getByTestId(`${route === 'setup' ? 'setup' : route}-page`).waitFor();
      if (route === 'setup') await page.getByRole('button', { name: /双桌 IMP/ }).click();
      const path = `artifacts/layout/${route}-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path, fullPage: true });
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      if (metrics.content > metrics.viewport + 1) throw new Error(`Horizontal overflow: ${path}`);
      rows.push({ path, ...metrics });
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/layout/validation.json', JSON.stringify({ browser: 'Edge Chromium', checks: rows, horizontalOverflow: false, physicalAndroid: 'not tested' }, null, 2));
console.log(`Captured ${rows.length} layouts; no horizontal overflow.`);
