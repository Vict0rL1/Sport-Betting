// `npm run export -- <predicciones|apuestas|papel|snapshots|benchmark> [--formato csv|json] [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD] [--sport x] [--salida fichero]`
import fs from 'node:fs';
import { getDb } from '../db.ts';
import { exportar, aCsv, DATASETS, type Dataset } from '../exports/datasets.ts';

const args = process.argv.slice(2);
const dataset = args.find((a) => !a.startsWith('--')) as Dataset | undefined;
const valor = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
if (!dataset || !(DATASETS as readonly string[]).includes(dataset)) {
  console.error(`Uso: npm run export -- <${DATASETS.join('|')}> [--formato csv|json] [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD] [--sport x] [--salida fichero]`);
  process.exit(1);
}
getDb();
const r = exportar(dataset, { desde: valor('--desde'), hasta: valor('--hasta'), sport: valor('--sport') });
const formato = valor('--formato') ?? 'csv';
const texto = formato === 'json' ? JSON.stringify({ dataset, filas: r.datos.length, columnas: r.columnas, datos: r.datos }, null, 2) + '\n' : aCsv(r.columnas, r.datos);
const salida = valor('--salida');
if (salida) {
  fs.writeFileSync(salida, texto);
  console.error(`✓ ${r.datos.length} filas en ${salida}`);
} else {
  process.stdout.write(texto);
}
