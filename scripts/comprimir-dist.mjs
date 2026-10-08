// Comprime web/dist al construir (Fase 7.1): un .br y un .gz al lado de cada fichero de texto, que
// @fastify/static sirve con `preCompressed` según lo que acepte el navegador. Sin dependencias.
// El index.html no: es pequeño, no lleva hash y se sirve con no-cache.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIST = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const TEXTO = /\.(js|mjs|css|svg|json|webmanifest|txt|map)$/;
let n = 0;
let antes = 0;
let despues = 0;
function recorrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(f);
    else if (TEXTO.test(e.name) && fs.statSync(f).size >= 1024) {
      const buf = fs.readFileSync(f);
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
      fs.writeFileSync(`${f}.br`, br);
      fs.writeFileSync(`${f}.gz`, zlib.gzipSync(buf, { level: 9 }));
      n++;
      antes += buf.length;
      despues += br.length;
    }
  }
}
if (!fs.existsSync(DIST)) {
  console.error(`No existe ${DIST}: corre la build antes.`);
  process.exit(1);
}
recorrer(DIST);
console.log(`comprimir-dist: ${n} ficheros, ${(antes / 1024).toFixed(0)} kB → ${(despues / 1024).toFixed(0)} kB con Brotli.`);
