// Paletas de sección — FRACTURA
// Cada ~260 m el mundo cambia de paleta: vidrio, cielo, niebla, acentos y música.

export const THEMES = [
  {
    id: 'hielo', name: 'HIELO CELESTE',
    glass: 0xa8e8ff, emissive: 0x2b7fd4,
    bgTop: 0x143a6b, bgBottom: 0x081224,
    fog: 0x0d2438, floor: 0x1b3a58, wall: 0x14263a,
    accent: 0x6fd7ff, accent2: 0x9dffef,
    root: 220, // A3
  },
  {
    id: 'ambar', name: 'ÁMBAR VESPERAL',
    glass: 0xffd9a6, emissive: 0xd8711f,
    bgTop: 0x3a1c06, bgBottom: 0x100500,
    fog: 0x2a1406, floor: 0x251409, wall: 0x1b0e06,
    accent: 0xffb45e, accent2: 0xffe0a8,
    root: 196, // G3
  },
  {
    id: 'orquidea', name: 'ORQUÍDEA NOCTURNA',
    glass: 0xe6c8ff, emissive: 0x8a2be2,
    bgTop: 0x241040, bgBottom: 0x0a0514,
    fog: 0x1c0c34, floor: 0x1a0f2e, wall: 0x140b24,
    accent: 0xc77dff, accent2: 0xff7ae6,
    root: 233, // Bb3
  },
  {
    id: 'esmeralda', name: 'ESMERALDA HÚMEDA',
    glass: 0xb8ffd9, emissive: 0x1fa463,
    bgTop: 0x06281c, bgBottom: 0x020e08,
    fog: 0x06221a, floor: 0x0a231a, wall: 0x081a13,
    accent: 0x5cf0a5, accent2: 0xc8ffe2,
    root: 207, // G#3
  },
  {
    id: 'rubi', name: 'RUBÍ INCANDESCENTE',
    glass: 0xffc4d4, emissive: 0xd11e56,
    bgTop: 0x2e0818, bgBottom: 0x0e0207,
    fog: 0x220814, floor: 0x220d16, wall: 0x180a10,
    accent: 0xff5c8a, accent2: 0xffb3c8,
    root: 185, // F#3
  },
  {
    id: 'neon', name: 'NEÓN ELÉCTRICO',
    glass: 0xc9f6ff, emissive: 0x00b8d9,
    bgTop: 0x1a0b3a, bgBottom: 0x04020e,
    fog: 0x120a2a, floor: 0x140d2a, wall: 0x0f0a20,
    accent: 0x00e5ff, accent2: 0xff4fd8,
    root: 246, // B3
  },
];

export function getTheme(index) {
  return THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
}

// Escala pentatónica menor (grados en semitonos) usada por la música procedural.
export const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

export function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8) |
         Math.round(ab + (bb - ab) * t);
}
