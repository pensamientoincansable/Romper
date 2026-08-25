// Captura cada paleta de FRACTURA con ?start=
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

for (const [name, meters] of [
  ['hielo', 0], ['ambar', 340], ['orquidea', 680], ['esmeralda', 1020], ['rubi', 1360], ['neon', 1700],
]) {
  await page.goto(`http://localhost:5173/?start=${meters}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.click('#btnStart');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/palette-${name}.png` });
  console.log('capturada', name, meters);
}
await browser.close();
