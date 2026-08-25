// Prueba de humo automatizada: arranca FRACTURA, juega y captura pantallas.
import { chromium as pw } from 'playwright';
import chromiumBin from '@sparticuz/chromium';
import { mkdirSync } from 'fs';

const BASE_URL = process.env.URL || 'http://localhost:5173';
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await pw.launch({
  executablePath: await chromiumBin.executablePath(),
  headless: true,
  args: [...chromiumBin.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(60000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '01-menu.png' });

const glInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return gl ? { ok: true } : { ok: false };
});
console.log('WebGL:', JSON.stringify(glInfo));

await page.click('#btnStart');
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '02-start.png' });

await page.mouse.move(480, 270);
await page.mouse.down();
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '03-shoot.png' });

for (let i = 0; i < 12; i++) {
  await page.mouse.move(480 + (i % 2 ? 230 : -230), 260 + (i % 3) * 40, { steps: 4 });
  await page.waitForTimeout(340);
}
await page.mouse.up();
await page.screenshot({ path: OUT + '04-after-sweep.png' });

const hud = await page.evaluate(() => ({
  score: document.getElementById('scoreVal')?.textContent,
  dist: document.getElementById('distReadout')?.textContent,
  ammo: document.getElementById('ammoReadout')?.textContent,
  hearts: document.getElementById('heartsRow')?.textContent,
}));
console.log('HUD:', JSON.stringify(hud));

await page.mouse.move(480, 270);
await page.mouse.down();
await page.waitForTimeout(9000);
await page.mouse.up();
await page.screenshot({ path: OUT + '05-late.png' });

const hud2 = await page.evaluate(() => ({
  score: document.getElementById('scoreVal')?.textContent,
  dist: document.getElementById('distReadout')?.textContent,
  ammo: document.getElementById('ammoReadout')?.textContent,
  hearts: document.getElementById('heartsRow')?.textContent,
  gameoverVisible: !document.getElementById('gameover').classList.contains('hidden'),
}));
console.log('HUD2:', JSON.stringify(hud2));

await page.click('#btnPause');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '06-pause.png' });
await page.click('#btnResume');
await page.waitForTimeout(300);

await browser.close();
console.log('ERRORES:', errors.length ? errors.join('\n') : 'ninguno');
process.exit(errors.length ? 1 : 0);
