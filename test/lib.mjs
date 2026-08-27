// Lanza Chromium headless (WebGL por software) para las pruebas de FRACTURA.
//
// El paquete @sparticuz/chromium empaqueta las librerías de red (NSS/NSPR)
// necesarias para el navegador en `bin/al2023.tar.br`, pero solo las monta
// automáticamente cuando se detecta Amazon Linux 2023 (AWS Lambda). En otros
// entornos (CI, desarrollo local) Chromium arranca fallando con
// "libnspr4.so: cannot open shared object file". Este helper las extrae y las
// expone vía LD_LIBRARY_PATH, de modo que las pruebas funcionan en cualquier
// sitio. En entornos que ya tienen las librerías el cambio es inofensivo.
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium as pw } from 'playwright';
import chromiumBin from '@sparticuz/chromium';

const nodeRequire = createRequire(import.meta.url);
let libDir = null;

// Devuelve la carpeta con libnspr4.so / libnss3.so / libnssutil3.so (extraída
// del paquete, si el sistema no las tiene ya).
export function chromiumLibDir() {
  if (libDir && existsSync(join(libDir, 'libnspr4.so'))) return libDir;
  const indexJs = nodeRequire.resolve('@sparticuz/chromium'); // …/chromium/build/index.js
  const tarBr = join(dirname(dirname(indexJs)), 'bin', 'al2023.tar.br');
  const dir = join(tmpdir(), 'fractura-chromium-libs');
  const destLib = join(dir, 'lib');
  if (!existsSync(join(destLib, 'libnspr4.so'))) {
    mkdirSync(dir, { recursive: true });
    const tarPath = join(dir, 'al2023.tar');
    writeFileSync(tarPath, brotliDecompressSync(readFileSync(tarBr)));
    execFileSync('tar', ['-xf', tarPath, '-C', dir]);
  }
  libDir = destLib;
  return libDir;
}

// Env para lanzar el navegador: librerías del paquete + fuentes del paquete.
export function chromiumEnv() {
  const lib = chromiumLibDir();
  const paths = new Set([lib, ...(process.env.LD_LIBRARY_PATH || '').split(':').filter(Boolean)]);
  return {
    ...process.env,
    LD_LIBRARY_PATH: [...paths].join(':'),
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH || join(tmpdir(), 'fonts'),
  };
}

// Lanzador equivalente al usado antes, pero con las librerías montadas.
export async function launchChromium() {
  return pw.launch({
    executablePath: await chromiumBin.executablePath(),
    headless: true,
    env: chromiumEnv(),
    args: [...chromiumBin.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
}
