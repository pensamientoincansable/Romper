// Verificación completa de jugabilidad de FRACTURA (headless, WebGL por software).
// Recorre todo el ciclo: menú → jugar → toque preciso (tirachinas) → romper y
// ganar esferas → ajustes (volumen/calidad/modo seguro) → pausa → game over
// → reintentar → menú. Sale con código 1 si cualquier comprobación falla.
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
  return { s: f.score(), b: f.breaks(), p: f.perfects(), a: f.ammo(), h: f.hearts(), d: f.gameDist(), shots: f.shots(), g: f.ammoGained() };
});
const setAim = (x, y) => page.evaluate(([xx, yy]) => window.__fractura.setAim(xx, yy), [x, y]);
const readAim = () => page.evaluate(() => window.__fractura.aim());

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
await page.waitForTimeout(400);
check('2. botón Jugar → estado playing', (await readState()) === 'playing');
check('2. HUD visible al empezar', !(await isHidden('hud')));
check('2. retícula visible al empezar', !(await isHidden('reticle')));
check('2. tirachinas en escena', await page.evaluate(() => window.__fractura.slingshot()));
check('2. espejo de cristal preparado (refleja el tirachinas)', await page.evaluate(() => window.__fractura.mirrorReady()));
await page.screenshot({ path: OUT + 'p2-jugando.png' });

// ------------------------------------------------- ritmo: arranque suave
const spdStart = await page.evaluate(() => window.__fractura.speed());
// Antes la partida arrancaba a 26 m/s al instante; ahora el crucero inicial es
// 4.2 m/s y se alcanza de forma gradual, así que la velocidad leída justo tras
// el clic debe seguir por debajo del propio crucero (todavía acelerando).
const spdInfo = await page.evaluate(() => window.__fractura.speedInfo());
check('2b. la partida arranca desde parado (v muy por debajo del antiguo 26 m/s)',
  spdStart < 26 * 0.25, `v = ${spdStart.toFixed(2)} m/s (crucero inicial ${spdInfo.base})`);
check('2b2. la velocidad parte de ~0 y crece despacio (configuración correcta)',
  spdInfo.base === 4.2 && spdInfo.gain === 0.0026 && spdInfo.cap === 30,
  `base ${spdInfo.base}, gain ${spdInfo.gain}, cap ${spdInfo.cap}`);
await page.waitForTimeout(1600);
const spd0 = await page.evaluate(() => window.__fractura.speed());
check('2b3. un momento después sigue acelerando suavemente (v < crucero)', spd0 < spdInfo.base, `v = ${spd0.toFixed(2)} m/s`);
const ballR = await page.evaluate(() => window.__fractura.ballR());
check('2c. la esfera mide un poco más de la mitad que antes', ballR > 0.19 * 0.5 && ballR < 0.19 * 0.68, `r = ${ballR}`);
const slingS = await page.evaluate(() => window.__fractura.slingScale());
check('2d. el tirachinas escala con la esfera', Math.abs(slingS - ballR / 0.19 * 0.95) < 1e-6, `escala ${slingS.toFixed(3)}`);

const d1 = (await readStats()).d;
await page.waitForTimeout(12000);
const d2 = (await readStats()).d;
check('3. el mundo avanza despacio (distancia crece sin despegar)', d2 > d1 + 1 && d2 - d1 < 60,
  `${d1.toFixed(1)} m → ${d2.toFixed(1)} m (+${(d2 - d1).toFixed(1)} m en ~12 s)`);
const spd1 = await page.evaluate(() => window.__fractura.speed());
check('3b. la velocidad sigue siendo baja al empezar (v < 10 m/s)', spd1 < 10, `v = ${spd1.toFixed(2)} m/s`);

// ------------------------------------------------- toque preciso (sin arrastrar)
const a0 = await readAim();
await page.mouse.move(300, 320); // mover sin pulsar NO debe arrastrar la puntería
await page.waitForTimeout(150);
const aHover = await readAim();
check('4. mover sin pulsar no arrastra la puntería', aHover.tx === a0.tx && aHover.ty === a0.ty,
  `(${a0.tx.toFixed(2)}, ${a0.ty.toFixed(2)}) → (${aHover.tx.toFixed(2)}, ${aHover.ty.toFixed(2)})`);

const sBeforeTap = (await readStats()).shots;
await page.mouse.move(620, 200);
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(250);
const aTap = await readAim();
check('4. tocar un punto re-apunta el disparo a ese punto', aTap.tx !== a0.tx || aTap.ty !== a0.ty,
  `(${a0.tx.toFixed(2)}, ${a0.ty.toFixed(2)}) → (${aTap.tx.toFixed(2)}, ${aTap.ty.toFixed(2)})`);
const sAfterTap = (await readStats()).shots;
check('4b. cada toque dispara una esfera', sAfterTap > sBeforeTap, `disparos ${sBeforeTap} → ${sAfterTap}`);

// ------------------------------------------------- mantener pulsado (ráfaga)
// Nota: en el entorno headless (SwiftShader) el juego va a ~1 fps y el
// enfriamiento de disparo drena en tiempo de juego, así que esperamos de sobra.
const s2 = sAfterTap;
await page.mouse.down();
await page.waitForTimeout(12000);
await page.mouse.up();
const s3 = (await readStats()).shots;
check('5. mantener pulsado dispara en ráfaga', s3 - s2 >= 2, `disparos ${s2} → ${s3}`);

// ------------------------------------------------- barrido para romper
await setAim(0, 1.7);
const g0 = (await readStats()).g;
await page.mouse.down();
let st = await readStats();
for (const [x, y] of [[1.2, 2.1], [1.5, 1.3], [0, 1.0], [-1.2, 2.1], [-1.5, 1.3], [0, 1.7]]) {
  await setAim(x, y);
  await page.waitForTimeout(2500);
}
await page.mouse.up();
for (let i = 0; i < 40 && st.s === 0 && st.b === 0; i++) {
  await page.waitForTimeout(500);
  st = await readStats();
}
check('6. disparar rompe vidrio o da puntos', st.s > 0 || st.b > 0,
  `puntos ${st.s}, roturas ${st.b}, perfectos ${st.p}, esferas restantes ${st.a}`);
const g1 = (await readStats()).g;
check('6b. romper objetos otorga esferas (economía de munición)', g1 > g0, `esferas ganadas ${g0} → ${g1}`);
check('6c. la munición nunca se hunde (recarga al romper)', st.a >= 0, `esferas actuales ${st.a}`);
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

// ------------------------------------------------------------- ajustes
await page.click('#btnSettings');
await page.waitForTimeout(400);
check('13. los ajustes se abren (y pausan)', !(await isHidden('settings')) && (await readState()) === 'paused');
await page.$eval('#volMaster', (el) => { el.value = 40; el.dispatchEvent(new Event('input')); });
await page.waitForTimeout(120);
const gain = await page.evaluate(() => window.__fractura.audioGain());
check('13. el deslizador de volumen cambia el volumen maestro', Math.abs(gain - 0.4) < 0.001, `ganancia ${gain}`);
await page.click('#qualitySeg button[data-q="baja"]');
await page.waitForTimeout(150);
const pr = await page.evaluate(() => window.__fractura.pixelRatio());
check('13. calidad baja reduce la resolución', pr <= 1.01, `pixelRatio ${pr}`);
await page.evaluate(() => window.__fractura.setSafeMode(true));
await page.waitForTimeout(150);
check('13. modo seguro apaga el bloom', (await page.evaluate(() => window.__fractura.bloomOn())) === false);
check('13. el modo seguro se refleja en el interruptor', await page.evaluate(() => document.getElementById('safeToggle').classList.contains('on')));
await page.click('#btnCloseSettings');
await page.waitForTimeout(300);
check('13. los ajustes se cierran', await isHidden('settings'));
await page.click('#btnResume');
await page.waitForTimeout(400);
check('13. se puede reanudar tras cerrar ajustes', (await readState()) === 'playing');

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
