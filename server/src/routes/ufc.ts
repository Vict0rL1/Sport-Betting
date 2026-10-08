// La UFC en sombra (seguimiento: NHL y UFC): la evaluación del backtest y la prueba para publicar,
// nunca una predicción. Detrás de `deportes.ufc` (apagado por defecto). Recorrer las peleas y el
// bootstrap cuestan ~1 s, así que se guarda en memoria hasta que cambie la tabla.

import type { FastifyInstance } from 'fastify';
import { featureEncendida } from '../features.ts';
import { getDb } from '../db.ts';
import { REFERENCIAS, contraReferencias, evaluarUfc, leerPeleas, VALIDACION } from '../ufc/evaluacion.ts';
import { UFC } from '../ufc/model.ts';
import { ESQUEMA_ERROR, ESQUEMA_UFC_SOMBRA } from '../api/schemas.ts';

let memo: { firma: string; valor: unknown } | null = null;

export function sombraUfc() {
  const f = getDb().prepare('SELECT COUNT(*) AS n, MAX(ingested_at) AS i, MAX(fecha) AS u FROM ufc_fights').get() as { n: number; i: string | null; u: string | null };
  const firma = `${f.n}|${f.i}`;
  if (memo?.firma === firma) return memo.valor;
  const peleas = leerPeleas();
  const r = evaluarUfc(peleas);
  const m = r.modelo;
  const clave = (nombre: string) => REFERENCIAS.find((x) => x.nombre === nombre)?.clave ?? 'otra';
  const tramo = (t: ReturnType<typeof contraReferencias>['todo']) => ({
    n: t.n,
    modelo: t.modelo,
    referencias: t.referencias.map((x) => ({ clave: clave(x.nombre), nombre: x.nombre, logLoss: x.ll, delta: x.mean, lo: x.lo, hi: x.hi, p: x.p })),
  });
  const cr = r.puntuadas ? contraReferencias(peleas) : null;
  const valor = {
    peleas: r.peleas,
    puntuadas: r.puntuadas,
    holdoutExcluido: r.holdoutExcluido,
    sinAtribuir: r.sinAtribuir,
    sinGanador: r.sinGanador,
    ultimo: f.u,
    modelo: m ? { n: m.n, logLoss: m.logLoss, brier: m.brier, accuracy: m.accuracy, ece: m.ece } : null,
    referencias: r.referencias.map((x) => ({ clave: clave(x.nombre), ...x })),
    porAnio: r.porAnio,
    prueba: cr
      ? {
          validacion: VALIDACION,
          todo: tramo(cr.todo),
          // Sin peleas en la validación no hay tramo que enseñar (ni que aprobar).
          enValidacion: cr.validacion.n ? tramo(cr.validacion) : null,
          pasa: cr.validacion.n > 0 && [...cr.todo.referencias, ...cr.validacion.referencias].every((x) => x.hi < 0),
        }
      : null,
    aviso: r.aviso,
    nota: r.nota,
    parametros: { k: UFC.k, provisionales: UFC.provisionales, factorProvisional: UFC.factorProvisional, bonoFinalizacion: UFC.bonoFinalizacion },
  };
  memo = { firma, valor };
  return valor;
}

export async function registerUfcRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/ufc/sombra',
    { schema: { tags: ['modelos'], summary: 'UFC en sombra: evaluación del backtest y prueba para publicar (sin holdout); nada se publica', response: { 200: ESQUEMA_UFC_SOMBRA, 404: ESQUEMA_ERROR } } },
    async (_req, reply) => {
      if (!featureEncendida('deportes.ufc')) return reply.code(404).send({ error: 'apagado (features.json: deportes.ufc)' });
      return sombraUfc();
    },
  );
}
