// Comprueba daño por colisión y pantalla de game over.
import { chromium as pw } from 'playwright';
import chromiumBin from '@sparticuz/chromium';
import { mkdirSync } from 'fs';

const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await pw.launch({
  executablePath: await chromiumBin.executablePath(),
  headless: true,
  args: [...chromiumBin.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(90000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5173/?start=0&debug=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
console.log('hook:', await page.evaluate(() => !!window.__fractura));
await page.click('#btnStart');
await page.waitForTimeout(800);

// daño 1..3
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__fractura.forceDamage());
  await page.waitForTimeout(900);
  const h = await page.evaluate(() => ({
    hearts: document.getElementById('heartsRow').textContent,
    state: window.__fractura.state(),
  }));
  console.log('daño', i + 1, JSON.stringify(h));
}
// daño 4 → game over
await page.evaluate(() => window.__fractura.forceDamage());
await page.waitForTimeout(2200);
const fin = await page.evaluate(() => ({
  state: window.__fractura.state(),
  over: !document.getElementById('gameover').classList.contains('hidden'),
  score: document.getElementById('statScore').textContent,
  dist: document.getElementById('statDist').textContent,
  best: document.getElementById('bestTitle').textContent,
}));
console.log('final:', JSON.stringify(fin));
await page.screenshot({ path: OUT + '07-gameover.png' });

// reintentar
await page.click('#btnRetry');
await page.waitForTimeout(900);
const retry = await page.evaluate(() => ({
  state: window.__fractura.state(),
  hearts: window.__fractura.hearts(),
  hud: !document.getElementById('hud').classList.contains('hidden'),
}));
console.log('retry:', JSON.stringify(retry));
await browser.close();
