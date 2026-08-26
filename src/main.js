// ============================================================================
// FRACTURA — juego minimalista de romper cristales
// Motor: three.js · 100% procedural (geometría, texturas, audio, UI)
// Estructura: corredor infinito · esferas metálicas · cristal de colores
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
const AIM_DIST = 55;               // profundidad del plano de puntería
const BALL_SPEED = 115;            // m/s de la esfera
const FIRE_COOLDOWN = 0.30;
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
  title: $('title'), gameover: $('gameover'), pause: $('pause'),
  btnStart: $('btnStart'), btnRetry: $('btnRetry'), btnMenu: $('btnMenu'),
  btnResume: $('btnResume'), btnPause: $('btnPause'), btnMute: $('btnMute'),
  flash: $('flash'), banner: $('banner'), bannerSub: $('bannerSub'),
  bannerWrap: $('bannerWrap'), statScore: $('statScore'), statDist: $('statDist'),
  statBreak: $('statBreak'), statPerf: $('statPerf'), bestTitle: $('bestTitle'),
  goReason: $('goReason'), webglError: $('webglError'), uiBtns: $('uiBtns'),
};

// Arranque diferido: el botón debe responder aunque Three.js aún no haya terminado.
let bootReady = false;
let pendingLaunch = false;
const SKIP_METERS = clamp(parseInt(new URLSearchParams(location.search).get('start') || '0', 10) || 0, 0, 5000);

function launchGameFromUI(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  pendingLaunch = true;
  tryStartPending();
}

function tryStartPending() {
  if (!pendingLaunch || !bootReady) return;
  if (typeof state !== 'undefined' && state === 'playing') {
    pendingLaunch = false;
    return;
  }
  pendingLaunch = false;
  safeAudio('init');
  startGame(SKIP_METERS);
}

function bindLaunch(node) {
  if (!node) return;
  node.addEventListener('pointerdown', launchGameFromUI, { capture: true });
  node.addEventListener('pointerup', launchGameFromUI, { capture: true });
  node.addEventListener('click', launchGameFromUI, { capture: true });
  node.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') launchGameFromUI(e);
  });
}
bindLaunch(el.btnStart);
bindLaunch(el.btnRetry);

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

// mapa de entorno procedural → reflejos en vidrio y metal
function makeEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#dff4ff');
  g.addColorStop(0.35, '#5f87ad');
  g.addColorStop(0.55, '#1c2c42');
  g.addColorStop(1, '#05080d');
  x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 5; i++) x.fillRect(rand(0, 250), rand(8, 40), rand(20, 60), 2);
  x.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 10; i++) x.fillRect(rand(0, 250), rand(50, 90), rand(8, 40), 1.5);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;

// ---------------------------------------------------------------------------
// Cielo (domo con gradiente) + estrellas
// ---------------------------------------------------------------------------
const skyUniforms = {
  topColor: { value: new THREE.Color(0x0a1e3f) },
  bottomColor: { value: new THREE.Color(0x03060f) },
  exponent: { value: 0.85 },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1900, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 bottomColor; uniform float exponent;
      varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        float f = pow(max(h, 0.0), exponent);
        gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);
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
const wallStripGeo = new THREE.BoxGeometry(0.12, SEG_LEN, 0.12);
const railGeo = new THREE.BoxGeometry(0.14, 0.14, SEG_LEN);
const lampGeo = new THREE.BoxGeometry(0.55, 0.1, SEG_LEN);

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
const railMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0x6fd7ff, emissiveIntensity: 1.25, roughness: 0.4, metalness: 0.2,
});

// marco de portal (U invertida) — da estructura y sensación de velocidad
const portalGeo = mergeGeometries([
  new THREE.BoxGeometry(0.16, 4.9, 0.16).translate(-TUNNEL_HALF + 0.08, 2.45, 0),
  new THREE.BoxGeometry(0.16, 4.9, 0.16).translate(TUNNEL_HALF - 0.08, 2.45, 0),
  new THREE.BoxGeometry(TUNNEL_HALF * 2, 0.16, 0.16).translate(0, 4.4, 0),
]);

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

    const mkRail = (x, y) => {
      const r = new THREE.Mesh(railGeo, railMat);
      r.position.set(x, y, zc);
      return r;
    };
    g.add(mkRail(TUNNEL_HALF - 0.12, 0.06));
    g.add(mkRail(-TUNNEL_HALF + 0.12, 0.06));
    g.add(mkRail(TUNNEL_HALF - 0.12, 4.62));
    g.add(mkRail(-TUNNEL_HALF + 0.12, 4.62));

    // línea de neón lateral a media altura
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, SEG_LEN), railMat);
    side.position.set(-TUNNEL_HALF + 0.06, 2.2, zc);
    const side2 = side.clone(); side2.position.x = TUNNEL_HALF - 0.06;
    g.add(side, side2);

    // lámpara central del techo
    const lamp = new THREE.Mesh(lampGeo, railMat);
    lamp.position.set(0, 4.42, zc);
    g.add(lamp);

    // marcos de portal cada 20 m (en coordenadas locales)
    for (let s = 0; s < SEG_LEN / 20; s++) {
      const z = -s * 20 - 30;
      const portal = new THREE.Mesh(portalGeo, railMat);
      portal.position.z = z;
      g.add(portal);
    }
    g.position.z = z0;
    scene.add(g);
    envSegments.push(g);
  }
}
buildEnv();

// ---------------------------------------------------------------------------
// Materiales compartidos (se actualizan al cambiar de paleta)
// ---------------------------------------------------------------------------
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xa8e8ff, roughness: 0.05, metalness: 0, transmission: 0.28,
  thickness: 0.7, transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  emissive: 0x2b7fd4, emissiveIntensity: 0.34, clearcoat: 1, envMapIntensity: 1.4,
});
const metalMat = new THREE.MeshStandardMaterial({
  color: 0xe8f2fa, roughness: 0.12, metalness: 1.0,
  emissive: 0x33465e, emissiveIntensity: 0.5, envMapIntensity: 1.8,
});
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
  ball: new THREE.SphereGeometry(0.19, 18, 14),
  shard: new THREE.TetrahedronGeometry(0.055),
  spark: new THREE.SphereGeometry(0.032, 6, 6),
};

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
    }
    for (let i = 0; i < Math.min(n, this.count); i++) this.mesh.setColorAt(i, new THREE.Color(0xffffff));
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

function destroyObstacle(o, power = 1) {
  const p = o.mesh.position.clone();
  const color = o.tint || (theme && theme.glass) || 0xa8e8ff;
  shards.burst(p.x, p.y, p.z, color, o.type === 'ring' || o.type === 'ringBig' ? 34 : 26, power);
  sparks.burst(p.x, p.y, p.z, theme.accent, 10, power);
  safeAudio('shatter', power);
  cleanupObstacle(o);
}

// --- tipos de obstáculo ---
function makePanel(x, y, z, sx = 1) {
  const mesh = new THREE.Mesh(GEO.panelSmall, glassMat);
  mesh.scale.set(sx, sx, 1);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rand(-0.06, 0.06);
  scene.add(mesh);
  const o = obstacleData('panel', mesh, { half: { x: 0.75 * sx, y: 0.75 * sx, z: 0.06 }, score: 15 });
  obstacles.push(o);
  return o;
}

function makeRing(x, y, z, big = false) {
  const mesh = new THREE.Mesh(big ? GEO.ringBig : GEO.ring, glassMat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const R = big ? 1.5 : 1.0, tube = big ? 0.32 : 0.22;
  const o = obstacleData('ring', mesh, {
    radius: R, tube, openR: R - tube, score: big ? 150 : 60, big,
  });
  obstacles.push(o);
  return o;
}

function makeColumn(x, z) {
  const mesh = new THREE.Mesh(GEO.column, glassMat);
  mesh.position.set(x, 1.8, z);
  scene.add(mesh);
  const o = obstacleData('column', mesh, { radius: 0.26, halfH: 1.8, score: 30 });
  obstacles.push(o);
  return o;
}

function makeCrystal(x, y, z, s = 1) {
  const mesh = new THREE.Mesh(GEO.crystal, glassMat);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(s);
  mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
  scene.add(mesh);
  const o = obstacleData('crystal', mesh, { radius: 0.3 * s, score: 35 });
  obstacles.push(o);
  return o;
}

function makeShelf(x, y, z) {
  const mesh = new THREE.Mesh(GEO.shelf, glassMat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const o = obstacleData('shelf', mesh, { half: { x: 1.15, y: 0.08, z: 0.27 }, score: 10 });
  obstacles.push(o);
  // esferas de munición encima de la repisa
  const n = randInt(6, 9);
  for (let i = 0; i < n; i++) {
    const bp = new THREE.Mesh(GEO.ball, metalMat);
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
  spawnCursor = z - rand(16, 26);
}

let lastPattern = -1;

function updateSpawner() {
  const lookAhead = 480;
  while (spawnCursor > -lookAhead - camera.position.z) spawnChamber();
}

// ---------------------------------------------------------------------------
// Esferas del jugador
// ---------------------------------------------------------------------------
const aim = { x: 0, y: 1.7 };
const aimTarget = { x: 0, y: 1.7 };
const camBase = new THREE.Vector3(0, CAM_HEIGHT, 0);
let recoil = 0;
let fireCooldown = 0;

function fireBall() {
  if (state !== 'playing' || ammo <= 0 || fireCooldown > 0) {
    if (ammo <= 0 && state === 'playing') safeAudio('click');
    return;
  }
  fireCooldown = FIRE_COOLDOWN;
  ammo--;
  updateAmmoUI();
  safeAudio('shoot');
  recoil = 1;

  const origin = camBase.clone().add(new THREE.Vector3(0, -0.08, 0.3));
  const target = new THREE.Vector3(aim.x, aim.y, camera.position.z - AIM_DIST);
  const dir = target.sub(origin).normalize();
  const mesh = new THREE.Mesh(GEO.ball, metalMat);
  mesh.position.copy(origin);
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(1.05, 1.05, 1);
  mesh.add(halo);
  scene.add(mesh);
  balls.push({
    mesh, vel: dir.multiplyScalar(BALL_SPEED), grazed: 0,
    bouncesX: 0, bouncesY: 0, life: 6, trailT: 0,
  });
  cameraBaseRecoil = 0.045;
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
      return dist > o.openR - 0.14 && dist < o.radius + o.tube + 0.18;
    }
    return false;
  }
  if (o.type === 'column') {
    const p = o.mesh.position;
    const dx = bx - p.x, dz = bz - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist < o.radius + 0.16 && Math.abs(by - p.y) < o.halfH;
  }
  if (o.type === 'crystal') {
    return b.mesh.position.distanceTo(o.mesh.position) < o.radius + 0.16;
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
    return dx * dx + dy * dy + dz * dz < 0.16 * 0.16;
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
  el.flash.classList.remove('hit'); void el.flash.offsetWidth; el.flash.classList.add('hit');
  hitStop = 0.55;
  timeScale = 0.35;
  popup('− 1', 0, 1.2, 0, '#ff5c8a');
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

function popup(text, x, y, z, color) {
  const v = new THREE.Vector3(x, y, z || 0);
  v.project(camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (sx < -60 || sx > window.innerWidth + 60 || sy < -60 || sy > window.innerHeight + 60) return;
  const d = document.createElement('div');
  d.className = 'popup' + (color ? ' gold' : '');
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
  sparks.burst(pu.mesh.position.x, pu.mesh.position.y, pu.mesh.position.z, theme.accent, 8, 0.8);
  popup('+1', pu.mesh.position.x, pu.mesh.position.y, pu.mesh.position.z);
}

// ---------------------------------------------------------------------------
// Banner / paletas
// ---------------------------------------------------------------------------
let bannerTimer = 0;
let themeIndex = 0;
let theme = THEMES[0];
let lastThemeDistance = 0;
let lastCheckpointDistance = 0;

function showBanner(title, sub = '') {
  el.banner.textContent = title;
  el.bannerSub.textContent = sub;
  el.bannerWrap.classList.add('show');
  bannerTimer = 2.6;
}

function applyTheme(idx) {
  themeIndex = ((idx % THEMES.length) + THEMES.length) % THEMES.length;
  theme = THEMES[themeIndex];

  glassMat.color.setHex(theme.glass);
  glassMat.emissive.setHex(theme.emissive);
  scene.fog.color.setHex(theme.fog);
  skyUniforms.topColor.value.setHex(theme.bgTop);
  skyUniforms.bottomColor.value.setHex(lerpColor(theme.bgBottom, theme.accent, 0.14));

  floorMat.color.setHex(lerpColor(theme.floor, theme.accent, 0.45));
  floorMat.emissive.setHex(theme.accent);
  wallMat.color.setHex(lerpColor(theme.wall, theme.accent, 0.12));
  wallMat.emissive.setHex(theme.accent);
  wallMat.emissiveIntensity = 0.3;
  railMat.color.setHex(theme.accent);
  railMat.emissive.setHex(theme.accent);
  glowFarglow.material.color.setHex(theme.accent);
  orbs[0].material.color.setHex(theme.accent2);
  orbs[1].material.color.setHex(theme.accent);
  orbs[2].material.color.setHex(theme.accent2);

  // luces suaves acordes con la paleta
  keyLight.color.setHex(lerpColor(0xffffff, theme.accent, 0.25));
  rimLight.color.setHex(theme.accent2);
  haloMat.color.setHex(theme.accent);

  document.documentElement.style.setProperty('--accent', '#' + theme.accent.toString(16).padStart(6, '0'));
  document.documentElement.style.setProperty('--accent2', '#' + theme.accent2.toString(16).padStart(6, '0'));

  safeAudio('setTheme', theme.root);
}

// ---------------------------------------------------------------------------
// Bucle principal / estado
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | playing | paused | over
let gameDist = 0;
let baseSpeed = 8;
let currentSpeed = 8;
let timeScale = 1;
let hitStop = 0;
let lastT = performance.now();
let cameraBaseRecoil = 0;
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
  lastPattern = -1;
  spawnCursor = -55 - skipMeters;
  lastThemeDistance = Math.floor(skipMeters / THEME_EVERY);
  lastCheckpointDistance = Math.floor(skipMeters / CHECKPOINT_EVERY);
  envSegments.forEach((seg, i) => { seg.position.z = -i * SEG_LEN; });
  applyTheme(Math.floor(skipMeters / THEME_EVERY));
  el.score.textContent = '0'; el.combo.textContent = '';
  updateAmmoUI(); updateHeartsUI();
  el.title.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.hud.classList.remove('hidden');
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
  baseSpeed = 8;
  pointerDown = false;
  spaceHeld = false;
  for (const o of [...obstacles]) cleanupObstacle(o);
  for (const pu of [...pickups]) { scene.remove(pu.mesh); }
  pickups.length = 0;
  for (const b of [...balls]) { scene.remove(b.mesh); }
  balls.length = 0;
  spawnCursor = -55;
  el.hud.classList.add('hidden');
  el.reticle.classList.add('hidden');
  el.uiBtns.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.title.classList.remove('hidden');
}

function gameOverRun() {
  if (state === 'over') return;
  state = 'over';
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
// Entrada
// ---------------------------------------------------------------------------
let pointerDown = false;
let lastPointer = { x: 0, y: 0 };

function onPointerDown(e) {
  if (state !== 'playing') return;
  if (e.target.closest('button, #uiBtns, .overlay')) return;
  e.preventDefault();
  pointerDown = true;
  lastPointer = { x: e.clientX, y: e.clientY };
  fireBall();
}
function onPointerMove(e) {
  if (state !== 'playing') return;
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  lastPointer = { x: e.clientX, y: e.clientY };
  aimTarget.x = clamp(aimTarget.x + dx * 0.012, -TUNNEL_HALF + 0.25, TUNNEL_HALF - 0.25);
  aimTarget.y = clamp(aimTarget.y - dy * 0.012, 0.7, 3.5);
}
function onPointerUp() { pointerDown = false; }

window.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
document.addEventListener('contextmenu', (e) => e.preventDefault());
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
  if (state === 'playing') return;
  safeAudio('init');
  startGame(SKIP_METERS);
}
el.btnStart.addEventListener('pointerup', launchGameFromUI);
el.btnStart.addEventListener('click', launchGameFromUI);
el.btnRetry.addEventListener('pointerup', launchGameFromUI);
el.btnRetry.addEventListener('click', launchGameFromUI);
el.btnMenu.addEventListener('click', endToMenu);
el.btnResume.addEventListener('click', resumeGame);
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
  currentSpeed = damp(currentSpeed, baseSpeed, 1.2, dt);
  baseSpeed = state === 'playing' ? Math.min(42, 27 + gameDist * 0.0022) : 8;
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
  camera.rotation.z = Math.sin(elapsed * 0.6) * 0.012 - recoil * 0.03;

  // puntería suavizada
  aim.x = damp(aim.x, aimTarget.x, 13, dt);
  aim.y = damp(aim.y, aimTarget.y, 13, dt);

  // retroceso
  recoil = Math.max(0, recoil - dt * 5);
  cameraBaseRecoil = Math.max(0, cameraBaseRecoil - dt * 0.4);
  camera.position.y += cameraBaseRecoil;

  // disparo
  fireCooldown = Math.max(0, fireCooldown - dt);
  if (pointerDown || spaceHeld) fireBall();

  // mover esferas del jugador (substeps para no atravesar cristales finos)
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.life -= dt;
    const speed = b.vel.length();
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.4));
    const stepDt = dt / steps;
    let consumed = false;
    for (let s = 0; s < steps && !consumed; s++) {
      const prevZ = b.mesh.position.z;
      b.mesh.position.addScaledVector(b.vel, stepDt);
      const p = b.mesh.position;
      // rebotes en paredes
      if (Math.abs(p.x) > TUNNEL_HALF - 0.18 && b.bouncesX < 2) {
        p.x = Math.sign(p.x) * (TUNNEL_HALF - 0.18);
        b.vel.x *= -0.55; b.bouncesX++;
        sparks.burst(p.x, p.y, p.z, theme.accent, 5, 0.7);
      }
      if ((p.y < 0.2 || p.y > 4.55) && b.bouncesY < 2) {
        p.y = clamp(p.y, 0.2, 4.55);
        b.vel.y *= -0.55; b.bouncesY++;
        sparks.burst(p.x, p.y, p.z, theme.accent, 5, 0.7);
      }
      // colisiones con vidrio
      for (let j = obstacles.length - 1; j >= 0; j--) {
        const o = obstacles[j];
        if (Math.abs(o.mesh.position.z - p.z) > 4) continue;
        if (collideBallWithObstacle(b, o, prevZ)) {
          const hitPoint = b.mesh.position.clone();
          shards.burst(hitPoint.x, hitPoint.y, hitPoint.z, theme.glass, 30, 1.2);
          sparks.burst(hitPoint.x, hitPoint.y, hitPoint.z, theme.accent, 14, 1.1);
          safeAudio('shatter', 1.1);
          if (o.type === 'shelf') dropPickupsFromShelf(o);
          const sc = o.score || 10;
          addScore(sc, hitPoint.x, hitPoint.y, hitPoint.z);
          breaks++;
          cleanupObstacle(o);
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
    if (consumed || b.life <= 0 || b.mesh.position.z > 4) {
      scene.remove(b.mesh);
      balls.splice(i, 1);
    }
  }

  // mover obstáculos hacia la cámara
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.prevZ = o.mesh.position.z;
    o.mesh.position.z += dz;
    if (o.type === 'crystal') o.mesh.rotation.y += dt * 0.8;
    // cruce de anillo sin tocarlo → ¡PERFECTO!
    if (state === 'playing' && o.type === 'ring' && o.prevZ <= 0 && o.mesh.position.z >= 0 && !o.kicked) {
      o.kicked = true;
      const dx = camBase.x - o.mesh.position.x, dy = camBase.y - o.mesh.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < o.openR * 0.82) {
        perfects++;
        addScore(90, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, '¡PERFECTO!');
      }
    }
    // impacto con el jugador
    if (state === 'playing' && o.prevZ <= 0 && o.mesh.position.z >= 0 && playerHitsObstacle(o)) {
      if (o.type === 'shelf') dropPickupsFromShelf(o);
      const hp = o.mesh.position;
      shards.burst(hp.x, hp.y, hp.z, theme.glass, 26, 1);
      damageHit(o);
      cleanupObstacle(o);
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

  // retícula
  const rp = new THREE.Vector3(aim.x, aim.y, camera.position.z - AIM_DIST);
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
updateAmmoUI();
updateHeartsUI();
bootReady = true;
tryStartPending();

// hook de depuración (solo si ?debug=1) — útil para pruebas automatizadas
if (new URLSearchParams(location.search).has('debug')) {
  window.__fractura = {
    forceDamage: () => damageHit(),
    state: () => state,
    hearts: () => hearts,
    gameDist: () => gameDist,
    cam: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, rx: camera.rotation.x, ry: camera.rotation.y, rz: camera.rotation.z }),
    segs: () => envSegments.slice(0, 14).map((s) => Math.round(s.position.z)),
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
