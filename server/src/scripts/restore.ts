// `npm run restore -- <fichero> --confirmar` — restaura una copia como libro mayor. Con el servidor
// PARADO: una conexión abierta seguiría escribiendo en el fichero viejo. Sin `--confirmar` no toca
// nada y dice qué haría. Sin argumento, lista las copias.
//
// `npm run restore -- --verificar <fichero>` — restauración de prueba, sin tocar el libro mayor:
// restaura en una carpeta temporal por el mismo camino y compara filas y huella de cada tabla.

import path from 'node:path';
import { copiasLocales, restaurarCopia, verificarRestauracion } from '../db/backup.ts';
import { ficherosDe, LAYOUT } from '../db/layout.ts';
import { opcionesComidasPorNpm, opcionesDesconocidas, restauracionConfirmada } from './restoreArgs.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const desconocidas = opcionesDesconocidas(process.argv.slice(2));
if (desconocidas.length) {
  console.error(`${C.red}✗ Opción desconocida: ${desconocidas.join(' ')}. Las únicas son --verificar (restauración de prueba) y --confirmar. No se ha tocado nada.${C.off}`);
  process.exit(1);
}
const comidas = opcionesComidasPorNpm();
if (comidas.length) {
  console.error(`${C.red}✗ npm se quedó ${comidas.join(' ')} porque falta «--» delante. Ponlo así:  npm run restore -- ${comidas.join(' ')} <fichero>. No se ha tocado nada.${C.off}`);
  process.exit(1);
}
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
// `npm run --workspace` ejecuta desde server/: las rutas relativas son de donde se lanzó npm.
const fichero = arg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), arg) : undefined;

if (fichero && process.argv.includes('--verificar')) {
  try {
    const v = verificarRestauracion(fichero);
    if (v.diferencias.length === 0) {
      console.log(`${C.green}✓${C.off} ${fichero} se restaura igual: ${v.tablas} tablas, ${v.filas} filas, mismas huellas ${C.dim}(el libro mayor no se ha tocado)${C.off}`);
      process.exit(0);
    }
    console.error(`${C.red}✗ Lo restaurado no es la copia:${C.off}`);
    for (const d of v.diferencias) console.error(`  ${d.tabla}: ${d.a ?? '—'} → ${d.b ?? '—'}${d.contenidoDistinto ? ' (mismas filas, contenido distinto)' : ''}`);
  } catch (e) {
    console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  }
  process.exit(1);
}

if (!fichero) {
  const copias = copiasLocales();
  console.log(`${C.bold}Copias locales${C.off} ${C.dim}(la más nueva primero)${C.off}`);
  if (copias.length === 0) console.log(`${C.dim}  ninguna. Haz una con  npm run backup${C.off}`);
  for (const c of copias) console.log(`  ${c.fichero}  ${C.dim}${(c.bytes / 1048576).toFixed(1)} MB · ${c.mtime}${C.off}`);
  console.log(`\nRestaurar:  ${C.bold}npm run restore -- <fichero> --confirmar${C.off}   (con el servidor parado)`);
  console.log(`Comprobar sin tocar nada:  ${C.bold}npm run restore -- --verificar <fichero>${C.off}`);
  process.exit(0);
}

if (LAYOUT !== 'split') {
  console.error(`${C.red}✗ En DB_LAYOUT=single no hay ledger.db que restaurar: quita DB_LAYOUT o ponlo en split.${C.off}`);
  process.exit(1);
}

if (!restauracionConfirmada(process.argv.slice(2))) {
  console.error(`${C.amber}Esto sustituiría el libro mayor por ${fichero}. No se ha tocado nada.${C.off}`);
  console.error(`  Para hacerlo, con el servidor parado:  ${C.bold}npm run restore -- ${arg} --confirmar${C.off}`);
  console.error(`  Para comprobar antes la copia:          ${C.bold}npm run restore -- --verificar ${arg}${C.off}`);
  process.exit(1);
}

try {
  console.log(`${C.amber}⚠ Asegúrate de que el servidor está parado.${C.off}`);
  const r = restaurarCopia(fichero);
  console.log(`${C.green}✓${C.off} Restaurado en ${r.destino}`);
  if (r.apartado) console.log(`${C.dim}· El libro mayor anterior quedó en ${r.apartado} (bórralo cuando te fíes del restaurado)${C.off}`);
  if (r.aviso) console.log(`${C.amber}⚠ ${r.aviso}${C.off}`);
  console.log(`${C.dim}· Historia intacta en ${ficherosDe().history}. Arranca y pasa  npm run doctor.${C.off}`);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
