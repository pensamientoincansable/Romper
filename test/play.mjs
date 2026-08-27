// Verificación completa de jugabilidad de FRACTURA (headless, WebGL por software).
// Recorre todo el ciclo: menú → jugar → disparar → romper → pausa → game over
// → reintentar → game over → menú. Sale con código 1 si cualquier comprobación falla.
//
// Nota: con WebGL por software (SwiftShader) el juego corre más lento que a
// tiempo real, por eso las comprobaciones usan esperas con sondeo (polling)
// con márgenes generosos en vez de tiempos fijos.
//
// Uso:  node test/play.mjs   (con el dev server corriendo en http://localhost:5173)
import { launchChromium } from './lib.mjs';
import { mkdirSync } from 'fs';

const BASE_URL = (process.env.URL || 'http://localhost:5173') + '/?debug=1';
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(60000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

const readState = () => page.evaluate(() => window.__fractura.state());
const isHidden = (id) => page.evaluate((elId) => document.getElementById(elId).classList.contains('hidden'), id);
const readStats = () => page.evaluate(() => {
  const f = window.__fractura;
  return { s: f.score(), b: f.breaks(), p: f.perfects(), a: f.ammo(), h: f.hearts(), d: f.gameDist() };
});

// ---------------------------------------------------------------- carga
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
check('1. carga sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));
check('1. canvas WebGL presente', !!(await page.$('canvas')));
check('1. menú de título visible', !(await isHidden('title')));
check('1. hook de depuración disponible', await page.evaluate(() => !!window.__fractura));
check('1. estado inicial = menu', (await readState()) === 'menu');
await page.screenshot({ path: OUT + 'p1-menu.png' });

// ---------------------------------------------------------------- jugar
await page.click('#btnStart');
await page.waitForTimeout(1600);
check('2. botón Jugar → estado playing', (await readState()) === 'playing');
check('2. HUD visible al empezar', !(await isHidden('hud')));
check('2. retícula visible al empezar', !(await isHidden('reticle')));
await page.screenshot({ path: OUT + 'p2-jugando.png' });

const d1 = (await readStats()).d;
await page.waitForTimeout(2500);
const d2 = (await readStats()).d;
check('3. el mundo avanza (distancia crece)', d2 > d1 + 1, `${d1.toFixed(1)} m → ${d2.toFixed(1)} m`);

// ------------------------------------------------- control de ratón (puntería por deltas)
// El ratón arranca en (0,0), así que el primer movimiento "consume" ese salto
// y satura la puntería en el borde; usamos el segundo movimiento (100 px a la
// izquierda, sin límites en contra) para comprobar que la puntería responde.
await page.mouse.move(480, 270);
await page.waitForTimeout(150);
const aimBefore = await page.evaluate(() => window.__fractura.aim());
await page.mouse.move(380, 270, { steps: 4 });
await page.waitForTimeout(200);
const aimAfter = await page.evaluate(() => window.__fractura.aim());
check('4. mover el ratón mueve la puntería', aimAfter.tx < aimBefore.tx - 0.8,
  `puntería x: ${aimBefore.tx.toFixed(2)} → ${aimAfter.tx.toFixed(2)}`);

// ------------------------------------------------- disparar y romper
// Apuntado determinista (hook de depuración) al eje central, donde pasan
// anillos, paneles y columnas; el disparo en sí lo hace el ratón de verdad.
const setAim = (x, y) => page.evaluate(([xx, yy]) => window.__fractura.setAim(xx, yy), [x, y]);
await setAim(0, 1.7);
const a1 = (await readStats()).a;
await page.mouse.down();
let st = await readStats();
for (let i = 0; i < 30 && st.a >= a1; i++) {
  await page.waitForTimeout(400);
  st = await readStats();
}
check('5. mantener pulsado dispara (la munición baja)', st.a < a1, `esferas ${a1} → ${st.a}`);

// barrido por la zona central para romper obstáculos
for (const [x, y] of [[1.2, 2.1], [1.5, 1.3], [0, 1.0], [-1.2, 2.1], [-1.5, 1.3], [0, 1.7]]) {
  await setAim(x, y);
  await page.waitForTimeout(700);
}
await page.mouse.up();
for (let i = 0; i < 50 && st.s === 0 && st.b === 0; i++) {
  await page.waitForTimeout(500);
  st = await readStats();
}
check('6. disparar rompe vidrio o da puntos', st.s > 0 || st.b > 0,
  `puntos ${st.s}, roturas ${st.b}, perfectos ${st.p}, esferas restantes ${st.a}`);
await page.screenshot({ path: OUT + 'p3-rompiendo.png' });

// ---------------------------------------------------------------- pausa
await page.click('#btnPause');
await page.waitForTimeout(500);
check('7. pausa muestra el overlay', !(await isHidden('pause')));
check('7. estado = paused', (await readState()) === 'paused');
const pd1 = (await readStats()).d;
await page.waitForTimeout(1500);
const pd2 = (await readStats()).d;
check('7. el mundo se detiene en pausa', Math.abs(pd2 - pd1) < 0.01, `${pd1.toFixed(2)} → ${pd2.toFixed(2)} m`);
await page.screenshot({ path: OUT + 'p4-pausa.png' });

await page.mouse.click(120, 460); // tocar el fondo de "Toca para continuar"
await page.waitForTimeout(700);
check('8. tocar la pausa reanuda la partida', (await readState()) === 'playing' && (await isHidden('pause')));

// ---------------------------------------------------------------- game over
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.__fractura.forceDamage());
  await page.waitForTimeout(750);
}
// (≤ 0: puede que el jugador ya se chocara con algo antes de forzar los daños)
check('9. 4 daños → sin vidas', (await readStats()).h <= 0);
await page.waitForTimeout(2500); // el overlay aparece tras el slow-motion
check('9. estado = over', (await readState()) === 'over');
check('9. pantalla de game over visible', !(await isHidden('gameover')));
await page.screenshot({ path: OUT + 'p5-gameover.png' });

// ---------------------------------------------------------------- reintentar
await page.click('#btnRetry');
await page.waitForTimeout(1400);
check('10. Reintentar → estado playing', (await readState()) === 'playing');
check('10. vidas y HUD restaurados', (await readStats()).h === 4 && !(await isHidden('hud')));
const rd = (await readStats()).d;
check('10. la distancia se reinicia', rd < 15, `${rd.toFixed(1)} m`);

// ---------------------------------------------------------------- menú (2ª partida)
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.__fractura.forceDamage());
  await page.waitForTimeout(750);
}
await page.waitForTimeout(2500);
check('11. 2ª partida también termina en game over', (await readState()) === 'over' && !(await isHidden('gameover')));
await page.click('#btnMenu');
await page.waitForTimeout(700);
check('11. Menú → estado menu + título visible', (await readState()) === 'menu' && !(await isHidden('title')));

// ---------------------------------------------------------------- sin errores
const finalErrors = errors.filter((e) => !/WebGL|swiftshader|ANGLE|GPU|dawn|skia/i.test(e));
check('12. sin errores de consola/página durante la partida', finalErrors.length === 0,
  finalErrors.slice(0, 3).join(' | '));
if (errors.length) console.log('   (errores crudos vistos: ' + errors.join(' | ') + ')');

await browser.close();
console.log(failures === 0 ? '\nRESULTADO: TODO OK — el juego se puede jugar.' : `\nRESULTADO: ${failures} comprobación(es) fallaron.`);
process.exit(failures ? 1 : 0);
