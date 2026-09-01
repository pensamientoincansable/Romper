// ============================================================================
// FRACTURA — juego minimalista de romper cristales
// Motor: three.js · 100% procedural (geometría, texturas, audio, UI)
// Estructura: corredor infinito · tirachinas con esferas metálicas · cristal
//              en espejos que reflejan el tirachinas · ajustes de volumen y
//              calidad · modo seguro para fotosensibilidad (epilepsia)
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioEngine } from './audio.js';
import { THEMES, lerpColor } from './themes.js';

const audio = new AudioEngine();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const damp = (cur, target, lambda, dt) => THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-lambda * dt));

function safeAudio(method, ...args) {
  try {
    const fn = audio?.[method];
    if (typeof fn === 'function') return fn.apply(audio, args);
  } catch (err) {
    console.warn(`[audio] ${method} desactivado:`, err);
  }
  return undefined;
}

function safeStorageGet(key, fallback = '') {
  try {
    return window.localStorage?.getItem(key) ?? fallback;
  } catch (err) {
    console.warn('[storage] localStorage no disponible:', err);
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch (err) {
    console.warn('[storage] No se pudo guardar la partida:', err);
  }
}

// ---------------------------------------------------------------------------
// Constantes de diseño
// ---------------------------------------------------------------------------
const TUNNEL_HALF = 3.8;          // semi-ancho del corredor
const SX = TUNNEL_HALF / 3;       // factor de escala lateral de los patrones
const CAM_HEIGHT = 1.62;
const AIM_DIST = 55;               // profundidad por defecto del plano de puntería
// Rango completo de disparo: la puntería puede acercarse o alejarse a voluntad.
const AIM_MIN = 4;                 // alcance mínimo (casi a quemarropa, dentro del túnel)
const AIM_MAX = 78;                // alcance máximo (más allá del plano por defecto)
const WHEEL_STEP = 6;              // metros por "clic" de rueda al ajustar el alcance
const GRAVITY = 15;                // m/s² — la esfera cae poco a poco (arco tipo Smash Hit)
const BALL_H_SPEED = 78;           // velocidad horizontal media de lanzamiento
const FIRE_COOLDOWN = 0.16;        // cadencia del tirachinas
// --- esfera iridiscente ---
// Radio de la esfera: un poco más de la mitad del tamaño original (0.19).
const BALL_R = 0.115;
const BALL_HIT = BALL_R * 0.84;    // radio de colisión (ligeramente permisivo)
// El tirachinas se adapta al tamaño de la bola: escala proporcional.
const SLING_SCALE = 0.95 * (BALL_R / 0.19);
// --- velocidad: arranca desde parado y crece muy lentamente ---
const SPEED_BASE = 4.2;            // velocidad de crucero al comenzar (m/s)
const SPEED_GAIN = 0.0026;         // m/s adicionales por cada metro recorrido
const SPEED_CAP = 30;              // tope de velocidad (muy lejos, tras kilómetros)
const MENU_SPEED = 3.2;            // deriva suave del fondo en el menú
const SLING_Y = -0.58;             // posición del tirachinas (respecto a la cámara)
const SLING_Z = -0.95;
const SEG_LEN = 80;                // longitud de cada segmento de entorno
const SEG_COUNT = 12;
const THEME_EVERY = 320;           // metros por cambio de paleta
const CHECKPOINT_EVERY = 600;      // metros entre recargas
const MAX_BALLS = 18;              // capacidad de munición mostrada

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const app = $('app');
const el = {
  hud: $('hud'), reticle: $('reticle'), hint: $('hint'),
  score: $('scoreVal'), combo: $('comboVal'), ammoReadout: $('ammoReadout'),
  ammoDots: $('ammoDots'), hearts: $('heartsRow'), dist: $('distReadout'),
  range: $('rangeReadout'),
  title: $('title'), gameover: $('gameover'), pause: $('pause'),
  settings: $('settings'), qualitySeg: $('qualitySeg'), safeToggle: $('safeToggle'),
  volMaster: $('volMaster'), volMusic: $('volMusic'), volSfx: $('volSfx'),
  volMasterVal: $('volMasterVal'), volMusicVal: $('volMusicVal'), volSfxVal: $('volSfxVal'),
  btnStart: $('btnStart'), btnRetry: $('btnRetry'), btnMenu: $('btnMenu'),
  btnResume: $('btnResume'), btnPause: $('btnPause'), btnMute: $('btnMute'),
  btnSettings: $('btnSettings'), btnSettingsPause: $('btnSettingsPause'),
  btnSettingsTitle: $('btnSettingsTitle'), btnSafeTitle: $('btnSafeTitle'),
  btnCloseSettings: $('btnCloseSettings'),
  flash: $('flash'), banner: $('banner'), bannerSub: $('bannerSub'),
  bannerWrap: $('bannerWrap'), statScore: $('statScore'), statDist: $('statDist'),
  statBreak: $('statBreak'), statPerf: $('statPerf'), bestTitle: $('bestTitle'),
  goReason: $('goReason'), webglError: $('webglError'), uiBtns: $('uiBtns'),
};

// ---------------------------------------------------------------------------
// Ajustes (volumen, calidad, modo seguro) — persistidos en localStorage
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { masterVol: 0.9, musicVol: 0.5, sfxVol: 1.0, quality: 'media', safeMode: true };
let settings = { ...DEFAULT_SETTINGS };
try {
  const raw = safeStorageGet('fractura_settings', '');
  if (raw) Object.assign(settings, JSON.parse(raw));
} catch (err) {
  console.warn('[settings] no se pudieron leer los ajustes:', err);
}

function saveSettings() {
  safeStorageSet('fractura_settings', JSON.stringify(settings));
}

// Límites de efectos según calidad y modo seguro (epilepsia)
function fxCaps() {
  const safe = settings.safeMode;
  const q = settings.quality;
  const shardBase = q === 'alta' ? 850 : q === 'media' ? 520 : 300;
  const sparkBase = q === 'alta' ? 260 : q === 'media' ? 170 : 100;
  return {
    shards: safe ? Math.min(shardBase, 14) : shardBase,
    sparks: safe ? Math.min(sparkBase, 7) : sparkBase,
    bloom: !safe && q !== 'baja',
    bloomStrength: q === 'alta' ? 0.5 : 0.3,
    pixelRatio: q === 'alta' ? Math.min(window.devicePixelRatio || 1, 2)
      : q === 'media' ? Math.min(window.devicePixelRatio || 1, 1.5)
      : 1,
    stars: q !== 'baja' ? 0.55 : 0.28,
  };
}

function applyQuality(q) {
  settings.quality = q;
  const caps = fxCaps();
  try { renderer.setPixelRatio(caps.pixelRatio); } catch (err) { /* sin importancia */ }
  try { renderer.setSize(window.innerWidth, window.innerHeight); } catch (err) { /* sin importancia */ }
  if (composer) {
    try { composer.setPixelRatio(caps.pixelRatio); } catch (err) { /* sin importancia */ }
    try { composer.setSize(window.innerWidth, window.innerHeight); } catch (err) { /* sin importancia */ }
  }
  if (bloom) {
    bloom.enabled = caps.bloom;
    bloom.strength = caps.bloomStrength;
  }
  stars.material.opacity = caps.stars;
  syncQualityUI();
}

function applySafeMode(safe) {
  settings.safeMode = safe;
  if (bloom) bloom.enabled = fxCaps().bloom;
  syncSafeUI();
}

function applySettings() {
  safeAudio('setMasterVolume', settings.masterVol);
  safeAudio('setMusicVolume', settings.musicVol);
  safeAudio('setSfxVolume', settings.sfxVol);
  applyQuality(settings.quality);
  applySafeMode(settings.safeMode);
  syncSettingsUI();
}

function syncSettingsUI() {
  const pairs = [['volMaster', 'volMasterVal', 'masterVol'], ['volMusic', 'volMusicVal', 'musicVol'], ['volSfx', 'volSfxVal', 'sfxVol']];
  for (const [id, vid, key] of pairs) {
    const inp = $(id);
    if (!inp) continue;
    inp.value = Math.round(settings[key] * 100);
    const out = $(vid);
    if (out) out.textContent = inp.value;
  }
  syncQualityUI();
  syncSafeUI();
}

function syncQualityUI() {
  if (!el.qualitySeg) return;
  el.qualitySeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
}

function syncSafeUI() {
  if (el.safeToggle) el.safeToggle.classList.toggle('on', settings.safeMode);
  if (el.btnSafeTitle) el.btnSafeTitle.textContent = settings.safeMode ? '♿ Seguro: ON' : '♿ Seguro: OFF';
}

function openSettings() {
  if (state === 'playing') pauseGame();
  el.settings.classList.remove('hidden');
}

function closeSettings() {
  el.settings.classList.add('hidden');
}

function wireSettingsUI() {
  const pairs = [
    ['volMaster', 'volMasterVal', 'masterVol', 'setMasterVolume'],
    ['volMusic', 'volMusicVal', 'musicVol', 'setMusicVolume'],
    ['volSfx', 'volSfxVal', 'sfxVol', 'setSfxVolume'],
  ];
  for (const [id, vid, key, fn] of pairs) {
    const inp = $(id);
    if (!inp) continue;
    inp.addEventListener('input', () => {
      settings[key] = inp.value / 100;
      const out = $(vid);
      if (out) out.textContent = inp.value;
      saveSettings();
      safeAudio(fn, settings[key]);
    });
  }
  el.qualitySeg?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { applyQuality(b.dataset.q); saveSettings(); });
  });
  el.safeToggle?.addEventListener('click', () => { applySafeMode(!settings.safeMode); saveSettings(); });
  el.btnSafeTitle?.addEventListener('click', () => { applySafeMode(!settings.safeMode); saveSettings(); });
  el.btnSettings?.addEventListener('click', openSettings);
  el.btnSettingsPause?.addEventListener('click', openSettings);
  el.btnSettingsTitle?.addEventListener('click', openSettings);
  el.btnCloseSettings?.addEventListener('click', closeSettings);
}

// La lógica de lanzamiento de los botones (Jugar / Reintentar) vive en la
// sección "Entrada", donde se declara SKIP_METERS. (Antes había aquí una
// segunda copia del bloque de arranque que re-declaraba const SKIP_METERS y
// rompía el parseo de todo el módulo → el botón Jugar no hacía nada.)

// ---------------------------------------------------------------------------
// Renderer / escena / cámara
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  el.webglError.classList.remove('hidden');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x081627, 0.0082);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 2600);
camera.position.set(0, CAM_HEIGHT, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Luces
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x101a2c, 1.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.75);
keyLight.position.set(6, 14, 8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xa0c8ff, 0.5);
fillLight.position.set(-6, 6, 10);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xff77ee, 0.5);
rimLight.position.set(-8, 4, -6);
scene.add(rimLight);

// Mapa de entorno procedural de alta calidad → reflejos físicos creíbles en
// vidrio, cristal y metal. Se usa también como fuente de luz ambiental (IBL).
function makeEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, '#eaf7ff');
  g.addColorStop(0.18, '#9fc7e8');
  g.addColorStop(0.34, '#5f87ad');
  g.addColorStop(0.52, '#24405f');
  g.addColorStop(0.72, '#101a2c');
  g.addColorStop(1.00, '#03060d');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  // franjas luminosas "conduit" que producen reflejos largos y limpios
  const strip = (y, wy, h, a) => {
    x.fillStyle = 'rgba(255,255,255,' + a + ')';
    x.fillRect(0, y, 512, h);
    for (let sx = rand(0, 500); sx < 512; sx += rand(24, 80)) {
      x.fillRect(sx, y + rand(-2, 2), rand(3, 14), h + rand(-1, 1));
    }
  };
  strip(24, 0, 3, 0.95);
  strip(58, 0, 2, 0.55);
  strip(120, 0, 2, 0.4);
  strip(176, 0, 1.5, 0.28);
  // manchas de luz difusa (ventanas de energía)
  x.fillStyle = 'rgba(140,220,255,0.22)';
  for (let i = 0; i < 14; i++) {
    const gx = rand(0, 500), gy = rand(12, 110);
    x.beginPath();
    x.ellipse(gx, gy, rand(12, 42), rand(4, 14), rand(0, 3.14), 0, 6.28);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;
scene.environmentIntensity = 1.15; // reflejos ambientales un punto más presentes

// ---------------------------------------------------------------------------
// Cielo (domo con gradiente multicapa + auroras sutiles) + estrellas
// ---------------------------------------------------------------------------
const skyUniforms = {
  topColor: { value: new THREE.Color(0x0a1e3f) },
  midColor: { value: new THREE.Color(0x0d2a52) },
  bottomColor: { value: new THREE.Color(0x03060f) },
  auroraColor: { value: new THREE.Color(0x9dffef) },
  uTime: { value: 0 },
  exponent: { value: 0.85 },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1900, 48, 24),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
      uniform vec3 auroraColor; uniform float uTime; uniform float exponent;
      varying vec3 vPos;
      void main(){
        vec3 dir = normalize(vPos);
        float h = dir.y;
        // gradiente en tres paradas: cenit → horizonte → abismo
        vec3 col = mix(bottomColor, midColor, smoothstep(-0.10, 0.24, pow(max(h, 0.0), exponent) + min(h, 0.0) * 0.6));
        col = mix(col, topColor, smoothstep(0.16, 0.78, h));
        // resplandor cálido justo en el horizonte (profundidad)
        col += midColor * 0.35 * smoothstep(0.16, 0.0, abs(h - 0.02));
        // auroras: dos bandas lentas, tenues y armoniosas (no estroboscópicas)
        float az = atan(dir.z, dir.x);
        float band = sin(az * 2.0 + uTime * 0.055 + sin(uTime * 0.031) * 1.6)
                   * sin(az * 3.0 - uTime * 0.037 + 2.1);
        float striate = 0.72 + 0.28 * sin(az * 22.0 + uTime * 0.16);
        float curtain = smoothstep(0.08, 0.55, h) * (0.5 + 0.5 * band) * striate;
        col += auroraColor * curtain * 0.045;
        // dithering: evita el banding en degradados oscuros
        float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (d - 0.5) * (1.6 / 255.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  })
);
scene.add(skyDome);

// estrellas (se reciclan alrededor de la cámara)
const STAR_COUNT = 750;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = rand(420, 1500);
  const th = rand(0, Math.PI * 2);
  const ph = rand(-0.9, 0.9);
  starPos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
  starPos[i * 3 + 1] = Math.sin(ph) * r * 0.7;
  starPos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 2.1, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: false,
}));
scene.add(stars);

// motas de polvo dentro del túnel (dan sensación de velocidad)
const DUST_COUNT = 320;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3] = rand(-TUNNEL_HALF + 0.4, TUNNEL_HALF - 0.4);
  dustPos[i * 3 + 1] = rand(0.1, 4.3);
  dustPos[i * 3 + 2] = rand(-220, 8);
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x9fd8ff, size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(dust);

// resplandor al fondo del túnel + orbes distantes (cambian con la paleta)
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const glowTex = makeGlowTexture();
const glowFarglow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0x6fd7ff, transparent: true, opacity: 0.12,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
glowFarglow.scale.set(260, 260, 1);
glowFarglow.position.set(0, 2.2, -1650);
scene.add(glowFarglow);

const orbs = [];
for (const [x, y, z, s, o] of [
  [-9, 11, -700, 240, 0.09], [10, 8, -850, 190, 0.07], [4.5, 14, -1050, 300, 0.055],
]) {
  const orb = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x9dffef, transparent: true, opacity: o,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  orb.scale.set(s, s, 1);
  orb.position.set(x, y, z);
  scene.add(orb);
  orbs.push(orb);
}

// ---------------------------------------------------------------------------
// Entorno del corredor (segmentos reciclables)
// ---------------------------------------------------------------------------
const envSegments = [];

// textura procedural del suelo (escala de grises → se tiñe con la paleta)
function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#202020'; x.fillRect(0, 0, 256, 512);
  // líneas longitudinales (u) — la v es la dirección de avance
  x.strokeStyle = '#5a5a5a'; x.lineWidth = 4;
  [12, 76, 180, 244].forEach((px) => { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, 512); x.stroke(); });
  x.strokeStyle = '#d8d8d8'; x.lineWidth = 6;
  x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 512); x.stroke();
  // marcas transversales
  x.strokeStyle = '#4a4a4a'; x.lineWidth = 3;
  for (let py = 64; py < 512; py += 128) { x.beginPath(); x.moveTo(0, py); x.lineTo(256, py); x.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
const floorTex = makeFloorTexture();
const floorMat = new THREE.MeshStandardMaterial({
  map: floorTex, emissiveMap: floorTex, emissive: 0x6fd7ff, emissiveIntensity: 0.55,
  color: 0x5c7ea6, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.5,
});

// textura de rejilla para las paredes (líneas que avanzan)
function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 512, 128);
  // líneas verticales espaciadas (una por tile → cada 40 m)
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(1, 0); x.lineTo(1, 128); x.stroke();
  // líneas horizontales tenues (paneles de cristal)
  x.lineWidth = 2;
  x.strokeStyle = 'rgba(255,255,255,0.22)';
  for (let py = 32; py < 128; py += 32) { x.beginPath(); x.moveTo(0, py); x.lineTo(512, py); x.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const wallTex = makeWallTexture();
wallTex.repeat.set(2, 1);
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x14243a, roughness: 0.85, metalness: 0.2,
  emissiveMap: wallTex, emissive: 0xffffff, emissiveIntensity: 0.3,
});

// ---------------------------------------------------------------------------
// Rejilla luminosa del corredor con InstancedBufferGeometry.
// Todos los elementos brillantes de un segmento (rieles, neón lateral, lámpara
// y marcos de portal) se dibujan en UNA sola llamada de dibujo, con un shader
// propio que aporta resplandor, pulso y un filo especular (fresnel) realista.
// Comparten un único material, de modo que el color se tiñe con la paleta en
// applyBlendedColors() sin recompilar nada.
// ---------------------------------------------------------------------------
const envGlowUniforms = {
  uColor: { value: new THREE.Color(0x6fd7ff) },
  uTime: { value: 0 },
};
const envGlowMat = new THREE.ShaderMaterial({
  uniforms: envGlowUniforms,
  vertexShader: `
    attribute mat4 instanceMatrix;
    varying vec3 vViewNormal;
    varying vec3 vViewPos;
    void main() {
      vec4 local = instanceMatrix * vec4(position, 1.0);
      vec4 mv = modelViewMatrix * local;
      gl_Position = projectionMatrix * mv;
      vViewPos = mv.xyz;
      vViewNormal = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    }`,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uTime;
    varying vec3 vViewNormal;
    varying vec3 vViewPos;
    void main() {
      vec3 N = normalize(vViewNormal);
      vec3 V = normalize(-vViewPos);
      // filo especular (fresnel) para que las aristas brillen como cristal
      float fres = pow(1.0 - abs(dot(N, V)), 2.2);
      // pulso suave y lento (nunca estroboscópico)
      float pulse = 0.82 + 0.18 * sin(uTime * 1.6);
      vec3 col = uColor * (0.9 + fres * 2.0) * pulse;
      gl_FragColor = vec4(col, 1.0);
    }`,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
  fog: false,
});

// Construye la geometría instanciada de un segmento (en su espacio local).
function makeEnvGlowGeometry(zc) {
  const base = new THREE.BoxGeometry(1, 1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('normal', base.attributes.normal);
  geo.setAttribute('uv', base.attributes.uv);

  // Recoge todas las instancias del segmento (rieles, neón, lámpara, portales).
  const items = [];
  const rail = (x, y) => items.push({ x, y, z: zc, sx: 0.14, sy: 0.14, sz: SEG_LEN });
  rail(TUNNEL_HALF - 0.12, 0.06);
  rail(-TUNNEL_HALF + 0.12, 0.06);
  rail(TUNNEL_HALF - 0.12, 4.62);
  rail(-TUNNEL_HALF + 0.12, 4.62);
  items.push({ x: -TUNNEL_HALF + 0.06, y: 2.2, z: zc, sx: 0.07, sy: 0.07, sz: SEG_LEN });
  items.push({ x: TUNNEL_HALF - 0.06, y: 2.2, z: zc, sx: 0.07, sy: 0.07, sz: SEG_LEN });
  items.push({ x: 0, y: 4.42, z: zc, sx: 0.55, sy: 0.1, sz: SEG_LEN });
  for (let s = 0; s < SEG_LEN / 20; s++) {
    const z = -s * 20 - 30;
    items.push({ x: -TUNNEL_HALF + 0.08, y: 2.45, z, sx: 0.16, sy: 4.9, sz: 0.16 });
    items.push({ x: TUNNEL_HALF - 0.08, y: 2.45, z, sx: 0.16, sy: 4.9, sz: 0.16 });
    items.push({ x: 0, y: 4.4, z, sx: TUNNEL_HALF * 2, sy: 0.16, sz: 0.16 });
  }

  const n = items.length;
  const matrix = new Float32Array(n * 16);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const it = items[i];
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    m.toArray(matrix, i * 16);
  }
  geo.setAttribute('instanceMatrix', new THREE.InstancedBufferAttribute(matrix, 16));
  geo.instanceCount = n;
  return geo;
}

function buildEnv() {
  for (let i = 0; i < SEG_COUNT; i++) {
    const g = new THREE.Group();
    const z0 = -i * SEG_LEN;          // posición del grupo en el mundo
    const zc = -SEG_LEN / 2;          // centro del segmento en coordenadas locales
    const floor = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_HALF * 2 + 6, 0.4, SEG_LEN), floorMat);
    floor.position.set(0, -0.2, zc);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_HALF * 2 + 6, 0.4, SEG_LEN), wallMat);
    ceil.position.set(0, 4.9, zc);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.4, SEG_LEN), wallMat);
    wallL.position.set(-TUNNEL_HALF - 0.2, 2.4, zc);
    const wallR = wallL.clone();
    wallR.position.x = TUNNEL_HALF + 0.2;
    g.add(floor, ceil, wallL, wallR);

    // Rejilla luminosa instanciada (rieles, neón lateral, lámpara y portales)
    // → una sola llamada de dibujo por segmento con InstancedBufferGeometry.
    const glow = new THREE.Mesh(makeEnvGlowGeometry(zc), envGlowMat);
    glow.frustumCulled = false;
    g.add(glow);
    g.position.z = z0;
    scene.add(g);
    envSegments.push(g);
  }
}
buildEnv();

// ---------------------------------------------------------------------------
// Materiales compartidos (se actualizan al cambiar de paleta)
// ---------------------------------------------------------------------------
// Vidrio de los paneles/columnas/repisas: refracción real + velo de
// iridiscencia + reflejos del entorno, con fresnel automático del material.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xa8e8ff, roughness: 0.03, metalness: 0,
  transmission: 0.62, thickness: 0.9, ior: 1.45,
  attenuationColor: 0x9fd8ff, attenuationDistance: 3.0,
  transparent: true, opacity: 0.82, side: THREE.DoubleSide,
  emissive: 0x2b7fd4, emissiveIntensity: 0.3, clearcoat: 1, clearcoatRoughness: 0.06,
  iridescence: 0.4, iridescenceIOR: 1.3, iridescenceThicknessRange: [140, 520],
  specularIntensity: 1, envMapIntensity: 1.85,
});
// (metalMat se retiró: todas las esferas usan ahora ballMat, iridiscente)
const haloMat = new THREE.SpriteMaterial({
  map: glowTex, color: 0xbfe8ff, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

// geometrías cacheadas
const GEO = {
  panel: new THREE.BoxGeometry(2.45, 1.85, 0.12),
  panelSmall: new THREE.BoxGeometry(1.5, 1.5, 0.12),
  ring: new THREE.TorusGeometry(1.0, 0.22, 12, 48),
  ringBig: new THREE.TorusGeometry(1.5, 0.32, 12, 52),
  column: new THREE.CylinderGeometry(0.22, 0.26, 3.6, 12),
  shelf: new THREE.BoxGeometry(2.3, 0.16, 0.55),
  crystal: new THREE.TetrahedronGeometry(0.3),
  ball: new THREE.SphereGeometry(BALL_R, 18, 14),
  shard: new THREE.TetrahedronGeometry(0.055),
  spark: new THREE.SphereGeometry(0.032, 6, 6),
};

// ---------------------------------------------------------------------------
// Esfera iridiscente: cambia de tono según la paleta del ambiente (tono
// complementario → máximo contraste) y oscila suavemente entre tonos afines,
// como una burbuja de jabón bajo la luz del corredor.
// ---------------------------------------------------------------------------
const ballMat = new THREE.MeshPhysicalMaterial({
  color: 0xf2f6ff, roughness: 0.09, metalness: 0.55,
  clearcoat: 1.0, clearcoatRoughness: 0.08,
  iridescence: 1.0, iridescenceIOR: 1.32, iridescenceThicknessRange: [120, 420],
  emissive: 0xb44dff, emissiveIntensity: 0.5, envMapIntensity: 2.2,
});

// ---------------------------------------------------------------------------
// Tirachinas (modelo procedural) + espejos que reflejan el tirachinas
// ---------------------------------------------------------------------------
function buildSlingshotModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x39435a, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfe0f2, metalness: 1.0, roughness: 0.18, envMapIntensity: 2 });
  // mango
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.042, 0.34, 10), dark);
  handle.position.set(0, -0.30, 0.10);
  handle.rotation.x = 0.5;
  // horquilla
  const armGeo = new THREE.CylinderGeometry(0.02, 0.028, 0.40, 8);
  const armL = new THREE.Mesh(armGeo, dark);
  armL.position.set(-0.14, 0.04, -0.02);
  armL.rotation.set(-0.12, 0, 0.55);
  const armR = armL.clone();
  armR.position.x = 0.14;
  armR.rotation.z = -0.55;
  // puntas
  const tipL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), chrome);
  tipL.position.set(-0.185, 0.21, -0.05);
  const tipR = tipL.clone();
  tipR.position.x = 0.185;
  // cuero con la esfera cargada (iridiscente, igual que las que se lanzan)
  const pocket = new THREE.Group();
  pocket.position.set(0, 0.16, 0.16);
  const ballMesh = new THREE.Mesh(GEO.ball, ballMat);
  ballMesh.scale.setScalar(1.15);
  pocket.add(ballMesh);
  // gomas elásticas
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x6b5330 });
  const bandGeo = new THREE.BoxGeometry(0.016, 0.016, 1);
  const bandL = new THREE.Mesh(bandGeo, bandMat);
  const bandR = new THREE.Mesh(bandGeo, bandMat);
  g.add(handle, armL, armR, tipL, tipR, pocket, bandL, bandR);
  g.userData = { pocket, bandL, bandR, tipL, tipR, ball: ballMesh, charge: 0, snap: 0 };
  return g;
}

const slingshot = buildSlingshotModel();
slingshot.scale.setScalar(SLING_SCALE); // proporciones adaptadas al tamaño de la bola
slingshot.position.set(0, SLING_Y, SLING_Z);
scene.add(camera);
camera.add(slingshot);
const slingWorldPos = new THREE.Vector3();
slingshot.getWorldPosition(slingWorldPos); // posición inicial válida para el primer disparo
const launchOrigin = new THREE.Vector3().copy(slingWorldPos); // bolsillo del tirachinas
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _unitZ = new THREE.Vector3(0, 0, 1);

// Cubemap de espejo: escena diminuta con el tirachinas, usada como reflejo de
// los cristales. Se genera una vez; los cristales son espejos pulidos que
// reflejan el tirachinas con el que lanzas las esferas.
function buildMirrorTexture() {
  const rt = new THREE.WebGLCubeRenderTarget(128);
  const cubeCam = new THREE.CubeCamera(0.1, 80, rt);
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0a1120);
  s.add(new THREE.HemisphereLight(0xcfe9ff, 0x141d30, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(4, 8, 6);
  s.add(key);
  const rim = new THREE.DirectionalLight(0xff77ee, 0.6);
  rim.position.set(-5, 3, -4);
  s.add(rim);
  const sl = buildSlingshotModel();
  sl.scale.setScalar(SLING_SCALE);
  sl.position.set(0, -0.75, 2.3);
  s.add(sl);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshStandardMaterial({ color: 0x182238, roughness: 0.55, metalness: 0.4 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.7;
  s.add(floor);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x6fd7ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(5, 5, 1);
  halo.position.set(0, 0.4, 2.4);
  s.add(halo);
  s.add(cubeCam);
  cubeCam.update(renderer, s);
  return rt.texture;
}
const mirrorTex = buildMirrorTexture();

// ---------------------------------------------------------------------------
// Cristal "de verdad": refracción física (transmission), dispersión / velo
// iridiscente en los bordes, espesor con absorción de color y el reflejo del
// tirachinas (cubemap) como espejo pulido. Es el material que se usa en los
// cristales rompibles, que se tiñen con la paleta en applyBlendedColors().
// ---------------------------------------------------------------------------
const crystalMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff4ff,
  metalness: 0,
  roughness: 0.015,
  transmission: 1.0,            // refracción real (cristal translúcido)
  ior: 1.52,                    // índice de refracción del cuarzo/vidrio
  thickness: 2.4,               // espesor → desplaza la refracción
  attenuationColor: 0xbfeaff,   // absorción: toma un tinte según el grosor
  attenuationDistance: 2.2,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  iridescence: 1.0,             // arcoíris de película fina en los bordes
  iridescenceIOR: 1.4,
  iridescenceThicknessRange: [220, 720],
  specularIntensity: 1.0,
  specularColor: 0xffffff,
  envMap: mirrorTex,            // refleja el tirachinas (espejo pulido)
  envMapIntensity: 3.0,
  emissive: 0x2457c8,
  emissiveIntensity: 0.28,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.92,
});

// ---------------------------------------------------------------------------
// Sistema de esquirlas (InstancedMesh)
// ---------------------------------------------------------------------------
class ShardSystem {
  constructor(count) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(GEO.shard, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
    }), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.rot = new Float32Array(count * 3);
    this.rotSpeed = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.baseScale = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.alive = 0;
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  get countAlive() { return this.alive; }

  burst(x, y, z, colorHex, n, power = 1, worldVel = 0) {
    const c = new THREE.Color(colorHex);
    for (let k = 0; k < n; k++) {
      const i = this.alive % this.count;
      this.alive++;
      this.pos[i * 3] = x + rand(-0.15, 0.15);
      this.pos[i * 3 + 1] = y + rand(-0.2, 0.2);
      this.pos[i * 3 + 2] = z + rand(-0.1, 0.1);
      const a = rand(0, Math.PI * 2), b = rand(-1, 1);
      const sp = rand(2, 9) * power;
      const r = Math.sqrt(1 - b * b);
      this.vel[i * 3] = Math.cos(a) * r * sp;
      this.vel[i * 3 + 1] = b * sp * 0.8 + rand(1, 3.5);
      this.vel[i * 3 + 2] = rand(-2.5, 1) + worldVel;
      this.rot[i * 3] = rand(0, 6.28); this.rot[i * 3 + 1] = rand(0, 6.28); this.rot[i * 3 + 2] = rand(0, 6.28);
      this.rotSpeed[i * 3] = rand(-9, 9); this.rotSpeed[i * 3 + 1] = rand(-9, 9); this.rotSpeed[i * 3 + 2] = rand(-9, 9);
      this.life[i] = rand(0.7, 1.6);
      this.maxLife[i] = this.life[i];
      this.baseScale[i] = rand(0.6, 1.65);
      this.color[i * 3] = c.r; this.color[i * 3 + 1] = c.g; this.color[i * 3 + 2] = c.b;
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, worldVel = 0) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const g = 14;
      this.vel[i * 3 + 1] -= g * dt;
      this.vel[i * 3] *= (1 - 0.6 * dt);
      this.vel[i * 3 + 2] *= (1 - 0.6 * dt);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + worldVel) * dt;
      if (this.pos[i * 3 + 1] < 0.03) { this.pos[i * 3 + 1] = 0.03; this.vel[i * 3 + 1] *= -0.35; }
      this.rot[i * 3] += this.rotSpeed[i * 3] * dt;
      this.rot[i * 3 + 1] += this.rotSpeed[i * 3 + 1] * dt;
      this.rot[i * 3 + 2] += this.rotSpeed[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const s = this.baseScale[i] * (0.4 + 0.6 * t);
      this._e.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      this._q.setFromEuler(this._e);
      this._v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this._s.set(s, s, s);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (this.life[i] <= 0) this._m.makeScale(0, 0, 0), this.mesh.setMatrixAt(i, this._m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Sistema de chispas (InstancedMesh aditivo)
// ---------------------------------------------------------------------------
class SparkSystem {
  constructor(count) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(GEO.spark, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.alive = 0;
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  burst(x, y, z, colorHex, n, power = 1) {
    const c = new THREE.Color(colorHex);
    for (let k = 0; k < n; k++) {
      const i = this.alive % this.count; this.alive++;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = rand(0, Math.PI * 2), b = rand(-1, 1);
      const sp = rand(4, 14) * power;
      const r = Math.sqrt(1 - b * b);
      this.vel[i * 3] = Math.cos(a) * r * sp;
      this.vel[i * 3 + 1] = b * sp;
      this.vel[i * 3 + 2] = rand(-6, 2);
      this.life[i] = rand(0.25, 0.6); this.maxLife[i] = this.life[i];
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt, worldVel = 0) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + worldVel) * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this._v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this._s.setScalar(t * rand(0.8, 1.4));
      this._q.identity();
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (this.life[i] <= 0) { this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const shards = new ShardSystem(850);
const sparks = new SparkSystem(260);

// ---------------------------------------------------------------------------
// Objetos del juego
// ---------------------------------------------------------------------------
const obstacles = [];   // {type, mesh, r, hp, prevZ, bonus}
const pickups = [];     // esferas de munición
const balls = [];       // esferas del jugador

function obstacleData(type, mesh, extra = {}) {
  return { type, mesh, prevZ: mesh.position.z, hp: 1, kicked: false, ...extra };
}

function cleanupObstacle(o) {
  scene.remove(o.mesh);
  const idx = obstacles.indexOf(o);
  if (idx >= 0) obstacles.splice(idx, 1);
}

function breakObstacle(o, hitPoint, byBall, power = 1) {
  const p = (hitPoint || o.mesh.position).clone();
  const caps = fxCaps();
  const color = o.mirror ? blendCur.accent2 : (o.tint || blendCur.glass);
  shards.burst(p.x, p.y, p.z, color, Math.min(o.type === 'ring' || o.type === 'ringBig' ? 30 : 22, caps.shards), power);
  sparks.burst(p.x, p.y, p.z, blendCur.accent, Math.min(9, caps.sparks), power);
  safeAudio('shatter', power);
  if (byBall) {
    const sc = o.score || 10;
    addScore(sc, p.x, p.y, p.z);
    breaks++;
    // economía de munición: cuanto más pequeño/difícil el objetivo, más esferas devuelve
    if ((o.reward || 1) > 0 && state === 'playing') grantBalls(o.reward || 1, p.x, p.y, p.z);
  }
  if (o.type === 'shelf') dropPickupsFromShelf(o);
  cleanupObstacle(o);
}

// Añade esferas al cargador (las suficientes para seguir rompiendo)
function grantBalls(n, x, y, z) {
  ammo = Math.min(maxAmmo, ammo + n);
  ammoGainedTotal += n;
  updateAmmoUI();
  popup('+' + n + ' ⬤', x, y, z, 'ammo');
}

// --- tipos de obstáculo ---
// sizeScale (dificultad) encoge poco a poco los objetivos a medida que avanzas;
// el reparto de esferas crece al encogerse el objetivo (más difícil de acertar).
function makePanel(x, y, z, sx = 1) {
  const s = Math.max(0.3, sx * sizeScale);
  const mesh = new THREE.Mesh(GEO.panelSmall, glassMat);
  mesh.scale.set(s, s, 1);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rand(-0.06, 0.06);
  scene.add(mesh);
  const o = obstacleData('panel', mesh, { half: { x: 0.75 * s, y: 0.75 * s, z: 0.06 }, score: 15 });
  o.reward = Math.max(2, Math.round(2.8 / s));
  obstacles.push(o);
  return o;
}

function makeRing(x, y, z, big = false) {
  const mesh = new THREE.Mesh(big ? GEO.ringBig : GEO.ring, glassMat);
  mesh.scale.setScalar(ringScale); // los anillos también encogen con la dificultad
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const R0 = big ? 1.5 : 1.0, tube0 = big ? 0.32 : 0.22;
  const R = R0 * ringScale, tube = tube0 * ringScale;
  const o = obstacleData('ring', mesh, {
    radius: R, tube, openR: R - tube, score: big ? 150 : 60, big,
  });
  // recompensa creciente: hilvanar un anillo pequeño da más esferas
  o.reward = Math.round((big ? 3 : 4) * (1 + (1 - ringScale) * 4.4));
  obstacles.push(o);
  return o;
}

function makeColumn(x, z) {
  const mesh = new THREE.Mesh(GEO.column, glassMat);
  mesh.position.set(x, 1.8, z);
  scene.add(mesh);
  const o = obstacleData('column', mesh, { radius: 0.26, halfH: 1.8, score: 30 });
  o.reward = 4;
  obstacles.push(o);
  return o;
}

function makeCrystal(x, y, z, s = 1) {
  const sc = Math.max(0.3, s * sizeScale);
  const mesh = new THREE.Mesh(GEO.crystal, crystalMat); // cristal: refracción + espejo del tirachinas
  mesh.position.set(x, y, z);
  mesh.scale.set(sc * 1.0, sc * 1.35, sc * 1.0); // tallado alargado de cristal
  mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
  scene.add(mesh);
  const o = obstacleData('crystal', mesh, { radius: 0.3 * sc, score: 35 });
  o.reward = Math.max(2, Math.round(2.8 / sc));
  o.mirror = true;
  obstacles.push(o);
  return o;
}

function makeShelf(x, y, z) {
  const mesh = new THREE.Mesh(GEO.shelf, glassMat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const o = obstacleData('shelf', mesh, { half: { x: 1.15, y: 0.08, z: 0.27 }, score: 10 });
  o.reward = 1;
  obstacles.push(o);
  // esferas de munición encima de la repisa
  const n = randInt(6, 9);
  for (let i = 0; i < n; i++) {
    const bp = new THREE.Mesh(GEO.ball, ballMat);
    bp.position.set(x + rand(-0.95, 0.95), y + 0.22, z + rand(-0.1, 0.1));
    scene.add(bp);
    pickups.push({
      mesh: bp, active: false, spawned: false,
      vel: new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0)), vr: rand(1, 6),
      r: 0.16, age: 0,
    });
  }
  return o;
}

function dropPickupsFromShelf(o) {
  for (const pu of pickups) {
    if (pu.spawned) continue;
    const d = pu.mesh.position.distanceTo(o.mesh.position);
    if (d < 3.2) {
      pu.spawned = true;
      pu.active = false;
      pu.vel.set(rand(-2, 2), rand(3, 6), rand(-2, 0.5));
    }
  }
}

// ---------------------------------------------------------------------------
// Patrones / generador de niveles
// ---------------------------------------------------------------------------
let spawnCursor = -60;
let rng = Math.random;
// Progresión: los objetivos se encogen muy poco a poco a medida que la velocidad
// (que también crece despacio) avanza; acertar se vuelve más difícil al mismo
// ritmo que el mundo se acelera. La economía de esferas compensa.
let sizeScale = 1;   // paneles y cristales
let ringScale = 1;   // anillos (menos reducción: atravesarlos es el reto)

const PATTERNS = [
  { w: 6, build: (z, R) => { // muro de cristal
      const cols = R() < 0.5 ? 2 : 3;
      const rows = 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = (c - (cols - 1) / 2) * 1.35 * SX;
          const y = 1.15 + r * 1.15;
          if (R() < 0.75) makePanel(x, y, z, rand(0.75, 1));
        }
      }
    } },
  { w: 4, build: (z, R) => { // anillo central
      makeRing(0, 1.7, z);
      if (R() < 0.35) { makeCrystal(rand(-2, 2) * SX, rand(0.8, 3.3), z + rand(-1, 1), rand(0.7, 1.3)); }
    } },
  { w: 7, build: (z, R) => { // columnas
      const n = randInt(2, 3);
      for (let i = 0; i < n; i++) makeColumn(pick([-1.7, -0.9, 0.9, 1.7]) * SX, z);
      if (R() < 0.5) makeRing(0, 1.7, z - 2);
    } },
  { w: 5, build: (z, R) => { // cadena de anillos (bonus perfecto)
      const n = randInt(2, 4);
      for (let i = 0; i < n; i++) makeRing(0, 1.7, z - i * 5.5, R() < 0.25);
    } },
  { w: 6, build: (z, R) => { // repisas laterales con munición
      makeShelf(-1.75 * SX, 1.6, z);
      if (R() < 0.6) makeShelf(1.75 * SX, 1.6, z - 3);
      if (R() < 0.5) makeRing(0, 1.7, z - 1.2, true);
    } },
  { w: 5, build: (z, R) => { // cristales en racimo
      const n = randInt(4, 7);
      for (let i = 0; i < n; i++) {
        makeCrystal(rand(-2.2, 2.2) * SX, rand(0.7, 3.2), z + rand(-1.6, 1.6), rand(0.6, 1.35));
      }
    } },
  { w: 8, build: (z, R) => { // pasillo de paneles alternos
      for (let i = 0; i < 3; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = side * rand(0.9, 1.9) * SX;
        makePanel(x, rand(1.0, 2.4), z - i * 1.4, rand(0.6, 0.9));
      }
      if (R() < 0.4) makeRing(0, 1.7, z - 4.5);
    } },
  { w: 3, build: (z, R) => { // portal doble
      makeRing(-0.95 * SX, 1.7, z, true);
      makeRing(0.95 * SX, 1.7, z, true);
    } },
];

function spawnChamber() {
  const R = Math.random;
  const z = spawnCursor;
  // dificultad: 72 % distancia recorrida + 28 % velocidad actual → la puntería
  // se vuelve exigente exactamente al ritmo en que el mundo se acelera
  const depth = clamp((gameDist + -z) / 2600, 0, 1);
  const diff = clamp(depth * 0.72 + (currentSpeed / SPEED_CAP) * 0.28, 0, 1);
  sizeScale = 1 - 0.26 * diff;
  ringScale = 1 - 0.18 * diff;
  // peso: evita repetir el mismo patrón dos veces seguidas
  const pool = lastPattern >= 0
    ? PATTERNS.filter((_, i) => i !== lastPattern)
    : PATTERNS.slice();
  const total = pool.reduce((a, p) => a + p.w, 0) || 1;
  let t = R() * total;
  let chosen = pool[0] || PATTERNS[0];
  for (const p of pool) { t -= p.w; if (t <= 0) { chosen = p; break; } }
  lastPattern = PATTERNS.indexOf(chosen);
  chosen.build(z, R);
  spawnCursor = z - rand(16, 26 - 4 * diff);
}

let lastPattern = -1;

function updateSpawner() {
  const lookAhead = 480;
  while (spawnCursor > -lookAhead - camera.position.z) spawnChamber();
}

// ---------------------------------------------------------------------------
// Tirachinas: lanzamiento balístico (la esfera cae poco a poco, como Smash Hit)
// ---------------------------------------------------------------------------
const aim = { x: 0, y: 1.7 };
const aimTarget = { x: 0, y: 1.7 };
const camBase = new THREE.Vector3(0, CAM_HEIGHT, 0);
let fireCooldown = 0;
let shotsFired = 0;
let ammoGainedTotal = 0;
// Profundidad actual de la puntería (rango completo: cercano ↔ lejano).
let aimDist = AIM_DIST;
const lastAimPoint = new THREE.Vector3(0, 1.7, -AIM_DIST); // último punto tocado

const ARC_PTS = 24; // puntos de la estela / arco previo

// Calcula la velocidad inicial para que la esfera alcance `target` con un arco
// parabólico, compensando el avance del mundo (los objetivos se acercan).
function computeBallistic(origin, target) {
  let effZ = target.z;
  let T = 0.5;
  for (let it = 0; it < 2; it++) {
    const d = Math.hypot(target.x - origin.x, effZ - origin.z);
    T = Math.max(0.32, d / BALL_H_SPEED);
    effZ = target.z + Math.min(currentSpeed * T, 26);
  }
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = effZ - origin.z;
  const v = new THREE.Vector3(dx / T, dy / T + 0.5 * GRAVITY * T, dz / T);
  return { v, T, landZ: effZ };
}

function pushTrail(b) {
  const t = b.trail;
  const p = b.mesh.position;
  if (t.n < ARC_PTS) t.n++;
  for (let i = t.n - 1; i > 0; i--) {
    t.pts[i * 3] = t.pts[(i - 1) * 3];
    t.pts[i * 3 + 1] = t.pts[(i - 1) * 3 + 1];
    t.pts[i * 3 + 2] = t.pts[(i - 1) * 3 + 2];
  }
  t.pts[0] = p.x; t.pts[1] = p.y; t.pts[2] = p.z;
  t.geo.attributes.position.needsUpdate = true;
  t.geo.setDrawRange(0, t.n);
  t.line.material.opacity = 0.12 + 0.32 * (t.n / ARC_PTS);
}

function disposeTrail(b) {
  scene.remove(b.trail.line);
  b.trail.line.geometry.dispose();
  b.trail.line.material.dispose();
}

function launchBall(targetX, targetY, targetZ) {
  if (state !== 'playing' || ammo <= 0 || fireCooldown > 0) {
    if (ammo <= 0 && state === 'playing') safeAudio('click');
    return false;
  }
  fireCooldown = FIRE_COOLDOWN;
  ammo--;
  shotsFired++;
  updateAmmoUI();
  safeAudio('shoot');
  safeAudio('twang');

  const origin = launchOrigin.clone();
  const target = new THREE.Vector3(targetX, targetY, targetZ);
  const { v } = computeBallistic(origin, target);
  const mesh = new THREE.Mesh(GEO.ball, ballMat);
  mesh.position.copy(origin);
  const halo = new THREE.Sprite(haloMat);
  const haloS = BALL_R * 4.8;
  halo.scale.set(haloS, haloS, 1);
  mesh.add(halo);
  scene.add(mesh);

  const trailPts = new Float32Array(ARC_PTS * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPts, 3));
  trailGeo.setDrawRange(0, 0);
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: ballMat.emissive.getHex(), transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  trailLine.frustumCulled = false;
  scene.add(trailLine);
  balls.push({
    mesh, vel: v, grazed: 0,
    bouncesX: 0, bouncesY: 0, life: 4, trailT: 0,
    trail: { pts: trailPts, geo: trailGeo, line: trailLine, n: 0 },
  });

  // el tirachinas suelta la goma
  const sl = slingshot.userData;
  sl.snap = 1;
  sl.charge = 0.35;
  return true;
}

// Arco previo (guía tenue de dónde caerá la esfera)
const ghostGeo = new THREE.BufferGeometry();
const ghostPts = new Float32Array(ARC_PTS * 3);
ghostGeo.setAttribute('position', new THREE.BufferAttribute(ghostPts, 3));
ghostGeo.setDrawRange(0, 0);
const ghostLine = new THREE.Line(ghostGeo, new THREE.LineBasicMaterial({
  color: 0x9fd8ff, transparent: true, opacity: 0.28,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
ghostLine.frustumCulled = false;
scene.add(ghostLine);

function updateGhostArc(origin, target) {
  const { v, T } = computeBallistic(origin, target);
  const p = origin;
  for (let i = 0; i < ARC_PTS; i++) {
    const t = (i / (ARC_PTS - 1)) * T;
    ghostPts[i * 3] = p.x + v.x * t;
    ghostPts[i * 3 + 1] = p.y + v.y * t - 0.5 * GRAVITY * t * t;
    ghostPts[i * 3 + 2] = p.z + v.z * t;
  }
  ghostGeo.attributes.position.needsUpdate = true;
  ghostGeo.setDrawRange(0, ARC_PTS);
  ghostLine.visible = state === 'playing';
}

// ---------------------------------------------------------------------------
// Colisiones esfera ↔ vidrio (y paredes)
// ---------------------------------------------------------------------------
function collideBallWithObstacle(b, o, prevZ) {
  const bx = b.mesh.position.x, by = b.mesh.position.y, bz = b.mesh.position.z;
  if (o.type === 'ring' || o.type === 'ringBig') {
    const p = o.mesh.position;
    if (prevZ >= p.z && bz < p.z) {
      const dx = bx - p.x, dy = by - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist > o.openR - BALL_HIT * 0.8 && dist < o.radius + o.tube + BALL_HIT * 0.95;
    }
    return false;
  }
  if (o.type === 'column') {
    const p = o.mesh.position;
    const dx = bx - p.x, dz = bz - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist < o.radius + BALL_HIT && Math.abs(by - p.y) < o.halfH;
  }
  if (o.type === 'crystal') {
    return b.mesh.position.distanceTo(o.mesh.position) < o.radius + BALL_HIT;
  }
  if (o.type === 'panel' || o.type === 'shelf') {
    const h = o.half;
    const p = o.mesh.position;
    const z0 = Math.min(prevZ, bz), z1 = Math.max(prevZ, bz);
    if (z1 < p.z - h.z || z0 > p.z + h.z) return false;
    const cx = clamp(bx, p.x - h.x, p.x + h.x);
    const cy = clamp(by, p.y - h.y, p.y + h.y);
    const cz = clamp(p.z, z0, z1);
    const dx = bx - cx, dy = by - cy, dz = p.z - cz;
    return dx * dx + dy * dy + dz * dz < BALL_HIT * BALL_HIT;
  }
  return false;
}

function collideBallWithPickup(ball, pu) {
  if (!pu.active || pu.spawned === false) return false;
  return ball.mesh.position.distanceToSquared(pu.mesh.position) < 0.95 * 0.95;
}

// ---------------------------------------------------------------------------
// Colisión jugador ↔ vidrio (impactos que restan vida)
// ---------------------------------------------------------------------------
function playerHitsObstacle(o) {
  const cx = camBase.x, cy = camBase.y;
  const p = o.mesh.position;
  // Los obstáculos avanzan desde z negativa hacia la cámara; evaluar al cruzar z = 0.
  if (!(o.prevZ <= 0.001 && p.z >= -0.001)) return false;
  if (o.type === 'ring' || o.type === 'ringBig') {
    const dx = cx - p.x, dy = cy - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist > o.openR - 0.1 && dist < o.radius + o.tube + 0.1;
  }
  if (o.type === 'column') {
    const dx = cx - p.x;
    return Math.abs(dx) < o.radius + 0.34 && Math.abs(cy - p.y) < o.halfH;
  }
  if (o.type === 'crystal') {
    const dx = cx - p.x, dy = cy - p.y;
    return dx * dx + dy * dy < (o.radius + 0.3) * (o.radius + 0.3);
  }
  if (o.type === 'panel' || o.type === 'shelf') {
    const h = o.half;
    const px = clamp(cx, p.x - h.x, p.x + h.x);
    const py = clamp(cy, p.y - h.y, p.y + h.y);
    const dx = cx - px, dy = cy - py;
    return dx * dx + dy * dy < 0.34 * 0.34;
  }
  return false;
}

function damageHit(o) {
  hearts--;
  combo = 0;
  updateHeartsUI();
  safeAudio('damage');
  if (settings.safeMode) {
    // modo seguro: sin destello estroboscópico, solo un pulso suave y lento
    el.flash.classList.remove('safePulse'); void el.flash.offsetWidth; el.flash.classList.add('safePulse');
    hitStop = 0.28;
    timeScale = 0.65;
  } else {
    el.flash.classList.remove('hit'); void el.flash.offsetWidth; el.flash.classList.add('hit');
    hitStop = 0.55;
    timeScale = 0.35;
  }
  popup('− 1', 0, 1.2, 0);
  if (hearts <= 0) gameOverRun();
}

// ---------------------------------------------------------------------------
// Puntuación / HUD
// ---------------------------------------------------------------------------
let score = 0, combo = 0, best = Number(safeStorageGet('fractura_best', '0') || 0);
let breaks = 0, perfects = 0;

function addScore(n, x, y, z, label) {
  const mult = 10 + Math.min(combo, 10); // ×10 … ×20
  const v = Math.round((n * mult) / 10);
  score += v;
  combo++;
  el.score.textContent = score;
  el.combo.textContent = combo >= 2 ? `COMBO ×${((10 + Math.min(combo - 1, 10)) / 10).toFixed(1)}` : '';
  popup(label || `+${v}`, x, y, z);
}

function popup(text, x, y, z, cls) {
  const v = new THREE.Vector3(x, y, z || 0);
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (sx < -60 || sx > window.innerWidth + 60 || sy < -60 || sy > window.innerHeight + 60) return;
  const d = document.createElement('div');
  d.className = 'popup' + (cls ? ' ' + cls : '');
  d.textContent = text;
  d.style.left = sx + 'px';
  d.style.top = sy + 'px';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 950);
}

// ---------------------------------------------------------------------------
// Munición / vidas
// ---------------------------------------------------------------------------
let ammo = 18;
const maxAmmo = 30;
for (let i = 0; i < MAX_BALLS; i++) {
  const d = document.createElement('div');
  d.className = 'dot';
  el.ammoDots.appendChild(d);
}

function updateAmmoUI() {
  const dots = el.ammoDots.children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('off', i >= ammo);
  el.ammoReadout.textContent = `${ammo} / ${maxAmmo}`;
}

let hearts = 4;

function updateHeartsUI() {
  el.hearts.textContent = '◆ '.repeat(Math.max(0, hearts)).trim() + '◇ '.repeat(Math.max(0, 4 - hearts)).trim();
}
updateHeartsUI();

function collectPickup(pu) {
  scene.remove(pu.mesh);
  const i = pickups.indexOf(pu);
  if (i >= 0) pickups.splice(i, 1);
  ammo = Math.min(maxAmmo, ammo + 1);
  updateAmmoUI();
  safeAudio('pickup');
  sparks.burst(pu.mesh.position.x, pu.mesh.position.y, pu.mesh.position.z, blendCur.accent, 8, 0.8);
  popup('+1', pu.mesh.position.x, pu.mesh.position.y, pu.mesh.position.z);
}

// ---------------------------------------------------------------------------
// Banner / paletas — con fundido lento entre ambientes (transición armónica)
// ---------------------------------------------------------------------------
let bannerTimer = 0;
let themeIndex = 0;
let theme = THEMES[0];
let lastThemeDistance = 0;
let lastCheckpointDistance = 0;

// Colores "actuales" (se funden hacia los objetivos cada frame) y "objetivo".
// Cada ranura alimenta una parte del mundo: niebla, cielo, luces, materiales…
const BLEND_SLOTS = [
  'accent', 'accent2', 'glass', 'glassEm', 'fog',
  'skyTop', 'skyMid', 'skyBottom', 'aurora',
  'floor', 'floorEm', 'wall', 'wallEm', 'rail', 'dust', 'star',
  'key', 'rim', 'fill', 'glowFar', 'orb0', 'orb1', 'orb2',
];
const blendCur = {}, blendTgt = {};
for (const k of BLEND_SLOTS) { blendCur[k] = new THREE.Color(); blendTgt[k] = new THREE.Color(); }
let blending = false; // true mientras queda fundido por hacer

function computeThemeTargets(th) {
  blendTgt.accent.setHex(th.accent);
  blendTgt.accent2.setHex(th.accent2);
  blendTgt.glass.setHex(th.glass);
  blendTgt.glassEm.setHex(th.emissive);
  blendTgt.fog.setHex(th.fog);
  blendTgt.skyTop.setHex(th.bgTop);
  blendTgt.skyBottom.setHex(lerpColor(th.bgBottom, th.accent, 0.14));
  blendTgt.skyMid.setHex(lerpColor(th.bgTop, th.accent, 0.24));
  blendTgt.aurora.setHex(th.accent2);
  blendTgt.floor.setHex(lerpColor(th.floor, th.accent, 0.45));
  blendTgt.floorEm.setHex(th.accent);
  blendTgt.wall.setHex(lerpColor(th.wall, th.accent, 0.12));
  blendTgt.wallEm.setHex(th.accent);
  blendTgt.rail.setHex(th.accent);
  blendTgt.dust.setHex(lerpColor(th.accent, 0xffffff, 0.45));
  blendTgt.star.setHex(lerpColor(0xffffff, th.accent2, 0.22));
  blendTgt.key.setHex(lerpColor(0xffffff, th.accent, 0.25));
  blendTgt.rim.setHex(th.accent2);
  blendTgt.fill.setHex(lerpColor(0xa0c8ff, th.accent, 0.35));
  blendTgt.glowFar.setHex(th.accent);
  blendTgt.orb0.setHex(th.accent2);
  blendTgt.orb1.setHex(th.accent);
  blendTgt.orb2.setHex(th.accent2);
}

// Vuelca los colores fundidos en materiales, luces, uniforms y variables CSS.
function applyBlendedColors() {
  glassMat.color.copy(blendCur.glass);
  glassMat.emissive.copy(blendCur.glassEm);
  crystalMat.color.copy(blendCur.glass);
  crystalMat.emissive.copy(blendCur.glassEm);
  crystalMat.attenuationColor.copy(blendCur.glass);
  scene.fog.color.copy(blendCur.fog);
  skyUniforms.topColor.value.copy(blendCur.skyTop);
  skyUniforms.midColor.value.copy(blendCur.skyMid);
  skyUniforms.bottomColor.value.copy(blendCur.skyBottom);
  skyUniforms.auroraColor.value.copy(blendCur.aurora);
  floorMat.color.copy(blendCur.floor);
  floorMat.emissive.copy(blendCur.floorEm);
  wallMat.color.copy(blendCur.wall);
  wallMat.emissive.copy(blendCur.wallEm);
  envGlowUniforms.uColor.value.copy(blendCur.rail);
  glowFarglow.material.color.copy(blendCur.glowFar);
  orbs[0].material.color.copy(blendCur.orb0);
  orbs[1].material.color.copy(blendCur.orb1);
  orbs[2].material.color.copy(blendCur.orb2);
  keyLight.color.copy(blendCur.key);
  rimLight.color.copy(blendCur.rim);
  fillLight.color.copy(blendCur.fill);
  stars.material.color.copy(blendCur.star);
  dust.material.color.copy(blendCur.dust);
  const hex = '#' + blendCur.accent.getHexString();
  const hex2 = '#' + blendCur.accent2.getHexString();
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent2', hex2);
}

function applyTheme(idx, instant = false) {
  themeIndex = ((idx % THEMES.length) + THEMES.length) % THEMES.length;
  theme = THEMES[themeIndex];
  computeThemeTargets(theme);
  if (instant) {
    for (const k of BLEND_SLOTS) blendCur[k].copy(blendTgt[k]);
    applyBlendedColors();
    blending = false;
  } else {
    blending = true; // el fundido ocurre poco a poco en updateThemeBlend
  }
  safeAudio('setTheme', theme.root);
}

// Fundido exponencial (~3 s) hacia la paleta objetivo; se llama cada frame.
function updateThemeBlend(dt) {
  if (!blending) return;
  const k = 1 - Math.exp(-dt * 1.35);
  let maxDelta = 0;
  for (const s of BLEND_SLOTS) {
    blendCur[s].lerp(blendTgt[s], k);
    maxDelta = Math.max(maxDelta, Math.abs(blendCur[s].r - blendTgt[s].r), Math.abs(blendCur[s].g - blendTgt[s].g), Math.abs(blendCur[s].b - blendTgt[s].b));
  }
  if (maxDelta < 0.0012) {
    for (const s of BLEND_SLOTS) blendCur[s].copy(blendTgt[s]);
    blending = false;
  }
  applyBlendedColors();
}

// Esfera iridiscente: tono complementario al ambiente (máximo contraste) con
// una deriva lenta entre tonos afines, como una película de aceite.
const _irHSL = { h: 0, s: 0, l: 0 };
function updateBallIridescence(t) {
  blendCur.accent.getHSL(_irHSL);
  const base = (_irHSL.h + 0.5) % 1; // complementario → contraste con el ambiente
  const h = (base + 0.055 * Math.sin(t * 0.85) + 0.04 * Math.sin(t * 0.33 + 2.1) + 2) % 1;
  ballMat.emissive.setHSL(h, 0.85, 0.58);
  ballMat.color.setHSL((h + 0.06) % 1, 0.5, 0.72);
  haloMat.color.copy(ballMat.emissive);
  ghostLine.material.color.copy(ballMat.emissive);
}

function showBanner(title, sub = '') {
  el.banner.textContent = title;
  el.bannerSub.textContent = sub;
  el.bannerWrap.classList.add('show');
  bannerTimer = 2.6;
}

// ---------------------------------------------------------------------------
// Bucle principal / estado
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | playing | paused | over
let gameDist = 0;
let currentSpeed = 0; // la partida empieza desde parado
let timeScale = 1;
let hitStop = 0;
let lastT = performance.now();
let elapsed = 0;
let hintTimer = 0;

function startGame(skipMeters = 0) {
  // reset
  for (const o of [...obstacles]) cleanupObstacle(o);
  for (const pu of [...pickups]) { scene.remove(pu.mesh); }
  pickups.length = 0;
  for (const b of [...balls]) { scene.remove(b.mesh); }
  balls.length = 0;
  score = 0; combo = 0; breaks = 0; perfects = 0;
  gameDist = skipMeters;
  hearts = 4; ammo = 18;
  timeScale = 1; hitStop = 0;
  fireCooldown = 0;
  pointerDown = false; spaceHeld = false;
  hoverScreen = null;
  aimDist = AIM_DIST; // el alcance vuelve al valor por defecto en cada partida
  updateRangeUI();
  lastAimPoint.set(0, 1.7, camera.position.z - AIM_DIST);
  aim.x = aimTarget.x = 0; aim.y = aimTarget.y = 1.7;
  slingshot.userData.charge = 0;
  slingshot.userData.snap = 0;
  bannerTimer = 0;
  el.bannerWrap.classList.remove('show');
  lastPattern = -1;
  // El cursor de generación es RELATIVO al jugador: empezar en ?start=N cambia
  // el ambiente y la dificultad, pero los obstáculos deben aparecer de inmediato.
  // (Antes se restaba skipMeters y el cursor quedaba fuera del rango de relleno
  // del spawner → túnel vacío durante decenas de segundos al saltar de paleta.)
  spawnCursor = -40;
  lastThemeDistance = Math.floor(skipMeters / THEME_EVERY);
  lastCheckpointDistance = Math.floor(skipMeters / CHECKPOINT_EVERY);
  envSegments.forEach((seg, i) => { seg.position.z = -i * SEG_LEN; });
  applyTheme(Math.floor(skipMeters / THEME_EVERY), true); // paleta inicial sin fundido
  currentSpeed = 0; // la carrera empieza desde parado y acelera despacio
  el.score.textContent = '0'; el.combo.textContent = '';
  updateAmmoUI(); updateHeartsUI();
  el.title.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.hud.classList.remove('hidden');
  el.hud.classList.add('playing');
  el.reticle.classList.remove('hidden');
  el.uiBtns.classList.remove('hidden');
  el.hint.classList.remove('hidden');
  el.hint.classList.remove('fade');
  hintTimer = 7;
  state = 'playing';
  safeAudio('resume');
  safeAudio('start');
  showBanner('¡A ROMPER!', theme.name);
}

function endToMenu() {
  state = 'menu';
  currentSpeed = MENU_SPEED;
  pointerDown = false;
  spaceHeld = false;
  hoverScreen = null;
  for (const o of [...obstacles]) cleanupObstacle(o);
  for (const pu of [...pickups]) { scene.remove(pu.mesh); }
  pickups.length = 0;
  for (const b of [...balls]) { scene.remove(b.mesh); }
  balls.length = 0;
  spawnCursor = -40;
  bannerTimer = 0;
  el.bannerWrap.classList.remove('show');
  el.hint.classList.add('hidden');
  el.hint.classList.remove('fade');
  el.hud.classList.add('hidden');
  el.hud.classList.remove('playing');
  el.reticle.classList.add('hidden');
  el.uiBtns.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.title.classList.remove('hidden');
}

function gameOverRun() {
  if (state === 'over') return;
  state = 'over';
  pointerDown = false; spaceHeld = false;
  safeAudio('gameOver');
  timeScale = 0.3;
  setTimeout(() => {
    el.statScore.textContent = score;
    el.statDist.textContent = Math.floor(gameDist) + ' m';
    el.statBreak.textContent = breaks;
    el.statPerf.textContent = perfects;
    const isBest = score > best;
    if (isBest) { best = score; safeStorageSet('fractura_best', String(best)); }
    el.bestTitle.textContent = (isBest ? '🏆 ¡NUEVO RÉCORD! · ' : 'Récord: ') + best;
    el.gameover.classList.remove('hidden');
  }, 1400);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  el.pause.classList.remove('hidden');
  safeAudio('stopMusic');
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  el.pause.classList.add('hidden');
  safeAudio('resume');
  safeAudio('setTheme', theme.root);
  safeAudio('resumeMusic');
}

// ---------------------------------------------------------------------------
// Entrada — toque/click preciso (tirachinas): se dispara exactamente al punto
// pulsado, sin arrastrar para apuntar. Mantener pulsado repite el disparo.
// ---------------------------------------------------------------------------
let pointerDown = false;
let hoverScreen = null; // puntero sin pulsar (para la guía del arco)
const tapRay = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function screenRayPoint(clientX, clientY, zPlane) {
  _ndc.x = (clientX / window.innerWidth) * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  tapRay.setFromCamera(_ndc, camera);
  const t = (zPlane - tapRay.ray.origin.z) / tapRay.ray.direction.z;
  if (!isFinite(t)) return null;
  return tapRay.ray.origin.clone().addScaledVector(tapRay.ray.direction, t);
}

// El punto exacto al que se dispara: si el rayo toca un obstáculo se apunta a
// él (precisión a cualquier profundidad); si no, al plano de puntería a la
// profundidad elegida (aimDist), que puede ir de muy cerca a muy lejos.
function pickTargetPoint(clientX, clientY) {
  _ndc.x = (clientX / window.innerWidth) * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  tapRay.setFromCamera(_ndc, camera);
  const r = tapRay.ray;
  let best = null;
  let bestT = Infinity;
  // Distancia máxima a la que buscamos objetivos = el alcance actual + un margen
  const reach = Math.max(aimDist, AIM_DIST) + 28;
  for (const o of obstacles) {
    const c = o.mesh.position;
    if (c.z < camera.position.z - reach) continue;
    if (o.type === 'ring' || o.type === 'ringBig') {
      const tPlane = (c.z - r.origin.z) / r.direction.z;
      if (tPlane < 0 || tPlane > bestT) continue;
      const px = r.origin.x + r.direction.x * tPlane;
      const py = r.origin.y + r.direction.y * tPlane;
      const d = Math.hypot(px - c.x, py - c.y);
      const R = o.radius || 1;
      const tube = o.tube || 0.22;
      if (Math.abs(d - R) < tube * 1.6 + 0.22) { bestT = tPlane; best = c; }
      continue;
    }
    const t = r.closestPointToPoint(c, _vA);
    const cp = r.at(t, _vB);
    const rad = (o.radius || (o.half ? Math.max(o.half.x, o.half.y) : 0.3)) * 1.25 + 0.18;
    if (t > 0 && t < bestT && cp.distanceTo(c) < rad) { bestT = t; best = c.clone(); }
  }
  if (best) return best;
  const p = screenRayPoint(clientX, clientY, camera.position.z - aimDist);
  if (!p) return null;
  p.x = clamp(p.x, -TUNNEL_HALF + 0.2, TUNNEL_HALF - 0.2);
  p.y = clamp(p.y, 0.35, 4.4);
  return p;
}

function aimAtPoint(p) {
  aim.x = p.x; aim.y = p.y;
  aimTarget.x = p.x; aimTarget.y = p.y;
  lastAimPoint.set(p.x, p.y, p.z);
}

function onPointerDown(e) {
  if (state !== 'playing') return;
  if (e.target.closest('button, #uiBtns, .overlay, input, .seg')) return;
  e.preventDefault();
  pointerDown = true;
  hoverScreen = { x: e.clientX, y: e.clientY };
  const p = pickTargetPoint(e.clientX, e.clientY);
  if (p) aimAtPoint(p);
  launchBall(lastAimPoint.x, lastAimPoint.y, lastAimPoint.z);
}
function onPointerMove(e) {
  if (state !== 'playing') return;
  hoverScreen = { x: e.clientX, y: e.clientY };
  if (pointerDown) {
    // manteniendo pulsado, la puntería sigue al dedo y sigue disparando
    const p = pickTargetPoint(e.clientX, e.clientY);
    if (p) aimAtPoint(p);
  }
}
function onPointerUp() { pointerDown = false; }

window.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Rango completo de disparo: la rueda del ratón acerca o aleja el plano de
// puntería. La retícula y el arco fantasma se actualizan en consecuencia.
function updateRangeUI() {
  if (el.range) el.range.textContent = 'Alcance — ' + Math.round(aimDist) + ' m';
  // La retícula se tiñe de acento2 cuando apuntamos muy cerca (rango corto).
  const near = aimDist <= 14;
  el.reticle.classList.toggle('near', near);
}
window.addEventListener('wheel', (e) => {
  if (state !== 'playing') return;
  e.preventDefault();
  aimDist = clamp(aimDist + (e.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP), AIM_MIN, AIM_MAX);
  updateRangeUI();
}, { passive: false });

let spaceHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; }
  if (e.code === 'KeyP') { state === 'playing' ? pauseGame() : (state === 'paused' ? resumeGame() : null); }
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

// ?start=800 → comienza a los 800 m (útil para probar paletas / reproducción)
const SKIP_METERS = clamp(parseInt(new URLSearchParams(location.search).get('start') || '0', 10) || 0, 0, 5000);
function launchGameFromUI(e) {
  e?.preventDefault?.();
  // El botón conserva el foco tras el clic; Espacio dispara esferas, así que
  // lo desenfocamos para que no se interprete como "reintento" accidental.
  if (e?.currentTarget?.blur) e.currentTarget.blur();
  if (state === 'playing') return;
  safeAudio('init');
  startGame(SKIP_METERS);
}
el.btnStart.addEventListener('click', launchGameFromUI);
el.btnRetry.addEventListener('click', launchGameFromUI);
el.btnMenu.addEventListener('click', endToMenu);
el.btnResume.addEventListener('click', resumeGame);
el.pause.addEventListener('click', resumeGame); // "Toca para continuar"
el.btnPause.addEventListener('click', () => { state === 'playing' ? pauseGame() : (state === 'paused' ? resumeGame() : null); });
el.btnMute.addEventListener('click', toggleMute);

let muted = false;
function toggleMute() {
  muted = !muted;
  safeAudio('init');
  safeAudio('setMuted', muted);
  el.btnMute.textContent = muted ? '♪̶' : '♪';
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

// ---------------------------------------------------------------------------
// Actualización de mundo
// ---------------------------------------------------------------------------
function updateWorld(dt) {
  // velocidad objetivo: parte casi de parado y crece muy lentamente con la
  // distancia; en el menú solo hay una deriva suave de fondo
  const targetSpeed = state === 'playing'
    ? Math.min(SPEED_CAP, SPEED_BASE + gameDist * SPEED_GAIN)
    : MENU_SPEED;
  currentSpeed = damp(currentSpeed, targetSpeed, state === 'playing' ? 0.7 : 1.2, dt);
  const dz = currentSpeed * dt;
  gameDist += dz;
  spawnCursor += dz; // el mundo avanza; el cursor de generación también

  // camera sway
  elapsed += dt;
  const swayX = Math.sin(elapsed * 0.9) * 0.12;
  const swayY = CAM_HEIGHT + Math.sin(elapsed * 1.9) * 0.05;
  camBase.x = damp(camBase.x, swayX, 4, dt);
  camBase.y = damp(camBase.y, swayY, 4, dt);
  camera.position.set(camBase.x, camBase.y, 0);
  camera.rotation.z = Math.sin(elapsed * 0.6) * 0.012;

  // puntería suavizada
  aim.x = damp(aim.x, aimTarget.x, 13, dt);
  aim.y = damp(aim.y, aimTarget.y, 13, dt);

  // --- tirachinas: orientación, goma elástica y balín cargado ---
  slingshot.getWorldPosition(slingWorldPos);
  slingshot.userData.pocket.getWorldPosition(launchOrigin); // la esfera sale del bolsillo

  // disparo (tirachinas): al mantener pulsado repite hacia el último punto
  fireCooldown = Math.max(0, fireCooldown - dt);
  if (pointerDown || spaceHeld) launchBall(lastAimPoint.x, lastAimPoint.y, lastAimPoint.z);
  {
    const sl = slingshot.userData;
    const ax = lastAimPoint.x - slingWorldPos.x;
    const ay = lastAimPoint.y - slingWorldPos.y;
    const az = lastAimPoint.z - slingWorldPos.z;
    const yaw = Math.atan2(ax, -az);
    const horiz = Math.hypot(ax, az);
    const pitch = Math.atan2(ay, horiz);
    slingshot.rotation.y = damp(slingshot.rotation.y, clamp(yaw, -0.6, 0.6), 16, dt);
    slingshot.rotation.x = damp(slingshot.rotation.x, clamp(-pitch, -0.45, 0.4), 16, dt);
    sl.charge = pointerDown ? Math.min(1, sl.charge + dt * 7) : Math.max(0, sl.charge - dt * 5);
    sl.snap = Math.max(0, sl.snap - dt * 6);
    const pull = sl.charge * (1 - sl.snap * 0.5);
    sl.pocket.position.z = 0.16 + pull * 0.22 - sl.snap * 0.05;
    sl.pocket.position.y = 0.16 + sl.snap * 0.03;
    for (const [tip, band] of [[sl.tipL, sl.bandL], [sl.tipR, sl.bandR]]) {
      const a = tip.position;
      const b = sl.pocket.position;
      band.position.copy(a).add(b).multiplyScalar(0.5);
      band.scale.z = a.distanceTo(b);
      // orientar en espacio local (el grupo puede estar rotado hacia el objetivo)
      _vC.copy(b).sub(a).normalize();
      band.quaternion.setFromUnitVectors(_unitZ, _vC);
    }
    const idle = 1 + Math.sin(elapsed * 2.2) * 0.012;
    slingshot.scale.setScalar(SLING_SCALE * idle);
  }

  // --- guía del arco (dónde caerá la próxima esfera) ---
  let ghostTarget = lastAimPoint;
  if (!pointerDown && hoverScreen) {
    const hp = pickTargetPoint(hoverScreen.x, hoverScreen.y);
    if (hp) ghostTarget = hp;
  }
  updateGhostArc(launchOrigin, ghostTarget);

  // mover esferas del jugador (substeps para no atravesar cristales finos)
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.life -= dt;
    b.vel.y -= GRAVITY * dt; // la esfera cae poco a poco (arco balístico)
    const speed = b.vel.length();
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.4));
    const stepDt = dt / steps;
    let consumed = false;
    for (let s = 0; s < steps && !consumed; s++) {
      const prevZ = b.mesh.position.z;
      b.mesh.position.addScaledVector(b.vel, stepDt);
      const p = b.mesh.position;
      const spk = Math.min(4, fxCaps().sparks);
      // rebotes en paredes
      if (Math.abs(p.x) > TUNNEL_HALF - 0.18 && b.bouncesX < 2) {
        p.x = Math.sign(p.x) * (TUNNEL_HALF - 0.18);
        b.vel.x *= -0.5; b.bouncesX++;
        sparks.burst(p.x, p.y, p.z, blendCur.accent, spk, 0.6);
      }
      if (p.y < 0.2 && b.vel.y < 0) {
        p.y = 0.2; b.vel.y *= -0.42; b.bouncesY++;
        sparks.burst(p.x, p.y, p.z, blendCur.accent, spk, 0.6);
      } else if (p.y > 4.55 && b.vel.y > 0) {
        p.y = 4.55; b.vel.y *= -0.42; b.bouncesY++;
        sparks.burst(p.x, p.y, p.z, blendCur.accent, spk, 0.6);
      }
      // colisiones con vidrio
      for (let j = obstacles.length - 1; j >= 0; j--) {
        const o = obstacles[j];
        if (Math.abs(o.mesh.position.z - p.z) > 4) continue;
        if (collideBallWithObstacle(b, o, prevZ)) {
          breakObstacle(o, b.mesh.position.clone(), true, 1.15);
          consumed = true;
          break;
        }
      }
      // recoger munición
      if (!consumed) {
        for (const pu of pickups) {
          if (collideBallWithPickup(b, pu)) { collectPickup(pu); break; }
        }
      }
    }
    pushTrail(b);
    if (consumed || b.life <= 0 || b.mesh.position.z > 4 || b.mesh.position.y < -3) {
      scene.remove(b.mesh);
      disposeTrail(b);
      balls.splice(i, 1);
    }
  }

  // mover obstáculos hacia la cámara
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.prevZ = o.mesh.position.z;
    o.mesh.position.z += dz;
    if (o.type === 'crystal') o.mesh.rotation.y += dt * 0.8;
    // cruce de anillo sin tocarlo → ¡PERFECTO! (bonus de esferas)
    if (state === 'playing' && o.type === 'ring' && o.prevZ <= 0 && o.mesh.position.z >= 0 && !o.kicked) {
      o.kicked = true;
      const dx = camBase.x - o.mesh.position.x, dy = camBase.y - o.mesh.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < o.openR * 0.82) {
        perfects++;
        safeAudio('perfect');
        addScore(90, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, '¡PERFECTO!');
        grantBalls(2, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
      }
    }
    // impacto con el jugador (no otorga esferas: chocarse no es romper)
    if (state === 'playing' && o.prevZ <= 0 && o.mesh.position.z >= 0 && playerHitsObstacle(o)) {
      const hp = o.mesh.position;
      damageHit(o);
      breakObstacle(o, hp.clone(), false, 1);
      continue;
    }
    if (o.mesh.position.z > 26) cleanupObstacle(o);
  }

  // mover y física de las esferas de munición
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pu = pickups[i];
    if (!pu.spawned) {
      pu.mesh.position.z += dz;
      if (pu.mesh.position.z > 26) { scene.remove(pu.mesh); pickups.splice(i, 1); }
      continue;
    }
    pu.age += dt;
    pu.vel.y -= 13 * dt;
    pu.mesh.position.addScaledVector(pu.vel, dt);
    pu.mesh.position.z += dz * 0.2;
    if (pu.mesh.position.y < 0.18) {
      pu.mesh.position.y = 0.18;
      pu.vel.y *= -0.62;
      pu.vel.x *= 0.9; pu.vel.z *= 0.9;
      if (Math.abs(pu.vel.y) > 1.2) safeAudio('metalBounce');
    }
    pu.mesh.rotation.x += pu.vr * dt; pu.mesh.rotation.y += pu.vr * 0.7 * dt;
    if (pu.age > 1.15) pu.active = true;
    // recoger al pasar cerca de la cámara
    const d2 = pu.mesh.position.distanceToSquared(camera.position);
    if (d2 < 1.1 * 1.1) { collectPickup(pu); continue; }
    if (pu.mesh.position.z > 8 || pu.mesh.position.z < -140) { scene.remove(pu.mesh); pickups.splice(i, 1); }
  }

  // reciclar entorno y estrellas
  // Nota: solo reciclar cuando el segmento está COMPLETO detrás de la cámara
  // (su borde trasero > SEG_LEN), si no se abre un hueco visible delante.
  for (const seg of envSegments) {
    seg.position.z += dz;
    if (seg.position.z > SEG_LEN + 24) seg.position.z -= SEG_LEN * SEG_COUNT;
  }
  // el suelo parece fluir hacia delante
  floorTex.offset.y -= dz / SEG_LEN;
  const sp = starGeo.attributes.position.array;
  for (let i = 0; i < STAR_COUNT; i++) {
    sp[i * 3 + 2] += dz;
    if (sp[i * 3 + 2] > 200) sp[i * 3 + 2] -= rand(1600, 2400);
  }
  starGeo.attributes.position.needsUpdate = true;

  const dp = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_COUNT; i++) {
    dp[i * 3 + 2] += dz;
    dp[i * 3] += Math.sin(elapsed * 2 + i) * 0.002;
    if (dp[i * 3 + 2] > 10) {
      dp[i * 3] = rand(-TUNNEL_HALF + 0.4, TUNNEL_HALF - 0.4);
      dp[i * 3 + 1] = rand(0.1, 4.3);
      dp[i * 3 + 2] -= rand(180, 260);
    }
  }
  dustGeo.attributes.position.needsUpdate = true;

  // niebla ligera según velocidad (sensación de inmersión)
  scene.fog.density = 0.0082 + currentSpeed * 0.00005;

  // ambiente: fundido suave entre paletas, iridiscencia de la esfera,
  // tiempo del cielo (auroras), titileo de estrellas y pulso del resplandor
  updateThemeBlend(dt);
  updateBallIridescence(elapsed);
  skyUniforms.uTime.value = elapsed;
  envGlowUniforms.uTime.value = elapsed;
  stars.material.opacity = fxCaps().stars * (0.86 + 0.14 * Math.sin(elapsed * 1.6));
  glowFarglow.material.opacity = 0.105 + 0.03 * Math.sin(elapsed * 0.42);

  // sistema de esquirlas y chispas
  shards.update(dt, dz);
  sparks.update(dt, dz);

  // paletas y checkpoints
  const themeDist = Math.floor(gameDist / THEME_EVERY);
  if (themeDist !== lastThemeDistance && state === 'playing') {
    lastThemeDistance = themeDist;
    applyTheme(themeDist);
    showBanner(theme.name, 'Sección ' + (themeDist + 1));
    safeAudio('checkpoint');
  }
  const cpDist = Math.floor(gameDist / CHECKPOINT_EVERY);
  if (cpDist !== lastCheckpointDistance && state === 'playing') {
    lastCheckpointDistance = cpDist;
    ammo = Math.min(maxAmmo, ammo + 4);
    updateAmmoUI();
    showBanner('RECARGA', '+4 esferas');
    safeAudio('checkpoint');
  }

  // HUD distancia
  el.dist.textContent = Math.floor(gameDist) + ' m';

  // banner
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) el.bannerWrap.classList.remove('show');
  }
  // hint
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) el.hint.classList.add('fade');
  }

  // retícula (a la profundidad elegida de alcance)
  const rp = new THREE.Vector3(aim.x, aim.y, camera.position.z - aimDist);
  rp.project(camera);
  const rsx = (rp.x * 0.5 + 0.5) * window.innerWidth;
  const rsy = (-rp.y * 0.5 + 0.5) * window.innerHeight;
  const rx = clamp(rsx - window.innerWidth / 2, -window.innerWidth * 0.42, window.innerWidth * 0.42);
  const ry = clamp(rsy - window.innerHeight / 2, -window.innerHeight * 0.42, window.innerHeight * 0.42);
  el.reticle.style.setProperty('--rx', rx + 'px');
  el.reticle.style.setProperty('--ry', ry + 'px');
}

// ---------------------------------------------------------------------------
// Bucle de render
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.066, Math.max(0.0001, (now - lastT) / 1000));
  lastT = now;

  // hit-stop y slow-motion
  if (hitStop > 0) {
    hitStop -= dt;
    dt = 0;
  } else if (state === 'playing' || state === 'menu') {
    timeScale = damp(timeScale, 1, 3, dt);
  }

  const sdt = dt * timeScale;

  if (state !== 'paused' && state !== 'over') {
    updateWorld(sdt);
    if (state === 'playing' || state === 'menu') updateSpawner();
  } else if (state === 'over') {
    // el mundo sigue deslizándose lentamente
    updateWorld(sdt * 0.5);
  }

  skyDome.position.copy(camera.position);
  stars.position.copy(camera.position);

  composer.render();
}

requestAnimationFrame(frame);
applyTheme(0, true); // siembra los colores fundidos con la primera paleta
updateAmmoUI();
updateHeartsUI();
wireSettingsUI();
applySettings(); // volumen, calidad y modo seguro guardados

// hook de depuración (solo si ?debug=1) — útil para pruebas automatizadas
if (new URLSearchParams(location.search).has('debug')) {
  window.__fractura = {
    forceDamage: () => damageHit(),
    state: () => state,
    hearts: () => hearts,
    gameDist: () => gameDist,
    score: () => score,
    ammo: () => ammo,
    breaks: () => breaks,
    perfects: () => perfects,
    obstacles: () => obstacles.length,
    shots: () => shotsFired,
    speed: () => currentSpeed,
    speedInfo: () => ({ cur: currentSpeed, cap: SPEED_CAP, base: SPEED_BASE, gain: SPEED_GAIN }),
    ballR: () => BALL_R,
    slingScale: () => SLING_SCALE,
    themeIndex: () => themeIndex,
    blending: () => blending,
    ammoGained: () => ammoGainedTotal,
    pointerDown: () => pointerDown,
    fireCooldown: () => fireCooldown,
    aim: () => ({ x: aim.x, y: aim.y, tx: aimTarget.x, ty: aimTarget.y }),
    // Apunta la puntería directamente (sin ratón) para pruebas deterministas.
    setAim: (x, y) => {
      aimTarget.x = clamp(x, -TUNNEL_HALF + 0.25, TUNNEL_HALF - 0.25);
      aimTarget.y = clamp(y, 0.7, 3.5);
      aim.x = aimTarget.x;
      aim.y = aimTarget.y;
      lastAimPoint.set(aim.x, aim.y, camera.position.z - aimDist);
    },
    aimDist: () => aimDist,
    setAimDist: (d) => { aimDist = clamp(d, AIM_MIN, AIM_MAX); updateRangeUI(); lastAimPoint.set(aim.x, aim.y, camera.position.z - aimDist); },
    cam: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, rx: camera.rotation.x, ry: camera.rotation.y, rz: camera.rotation.z }),
    segs: () => envSegments.slice(0, 14).map((s) => Math.round(s.position.z)),
    // --- ajustes / accesibilidad (para pruebas) ---
    slingshot: () => !!slingshot && scene.getObjectById(slingshot.id) != null,
    mirrorReady: () => !!mirrorTex,
    mirrorCount: () => obstacles.filter((o) => o.mirror).length,
    settings: () => ({ ...settings }),
    setSettings: (s) => { Object.assign(settings, s); saveSettings(); applySettings(); },
    setSafeMode: (v) => { applySafeMode(!!v); saveSettings(); },
    setQuality: (q) => { applyQuality(q); saveSettings(); },
    bloomOn: () => !!(bloom && bloom.enabled),
    pixelRatio: () => renderer.getPixelRatio(),
    audioGain: () => audio.masterVol,
  };
}

// ---------------------------------------------------------------------------
// Redimensionado
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});
