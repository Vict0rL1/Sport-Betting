// Qué alertas dispara cada hecho guardado. Funciones puras sobre «antes» y «después»: el
// que guarda el hecho las llama y emite lo que devuelvan (alerts/engine.ts).

import type { TipoAlerta, Alerta } from './engine.ts';

export interface Disparo {
  type: TipoAlerta;
  severity: Alerta['severity'];
  title: string;
  body: string;
  data?: unknown;
}

const pp = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} pp`;

/** Entre dos instantáneas pre-partido del mismo partido. */
export function deInstantanea(
  antes: { probs: number[]; market_probs: number[] | null; entradas: Record<string, { etiqueta: string; valor: unknown }> },
  despues: { probs: number[]; market_probs: number[] | null; entradas: Record<string, { etiqueta: string; valor: unknown }>; outcomes: string[] },
  partido: string,
): Disparo[] {
  const out: Disparo[] = [];
  const d = despues.probs.map((p, i) => p - (antes.probs[i] ?? p));
  const i = d.reduce((m, x, k) => (Math.abs(x) > Math.abs(d[m]) ? k : m), 0);
  if (Math.abs(d[i]) >= 0.03) {
    out.push({ type: 'cambio_prediccion', severity: Math.abs(d[i]) >= 0.06 ? 'importante' : 'aviso', title: `${partido}: la predicción se mueve ${pp(d[i])}`, body: `${despues.outcomes[i]}: ${(antes.probs[i] * 100).toFixed(1)} % → ${(despues.probs[i] * 100).toFixed(1)} %`, data: { delta: d } });
  }
  if (antes.market_probs && despues.market_probs) {
    const m = despues.market_probs.map((p, k) => p - (antes.market_probs as number[])[k]);
    const j = m.reduce((a, x, k) => (Math.abs(x) > Math.abs(m[a]) ? k : a), 0);
    if (Math.abs(m[j]) >= 0.05) out.push({ type: 'mercado_movido', severity: 'aviso', title: `${partido}: el mercado se mueve ${pp(m[j])}`, body: `${despues.outcomes[j]} en el mercado: ${(antes.market_probs[j] * 100).toFixed(1)} % → ${(despues.market_probs[j] * 100).toFixed(1)} %`, data: { delta: m } });
  }
  for (const [k, e] of Object.entries(despues.entradas)) {
    const v0 = antes.entradas[k]?.valor ?? null;
    if (v0 === e.valor) continue;
    if (k.startsWith('once') && e.valor === true) out.push({ type: 'alineacion_confirmada', severity: 'info', title: `${partido}: ${e.etiqueta}`, body: 'La alineación oficial ya está publicada.' });
    if (k.startsWith('abridor')) out.push({ type: 'abridor_cambiado', severity: v0 == null ? 'info' : 'importante', title: `${partido}: ${e.etiqueta}`, body: `${v0 ?? 'sin anunciar'} → ${e.valor ?? 'sin anunciar'}` });
    if (k.startsWith('qb')) out.push({ type: 'qb_cambiado', severity: 'importante', title: `${partido}: ${e.etiqueta}`, body: `${v0 ?? 'desconocido'} → ${e.valor ?? 'desconocido'}` });
  }
  return out;
}

/** Entre dos evaluaciones de confianza del mismo partido (la primera puede no existir). */
export function deEvaluacion(
  antes: { decision: string; data_quality: number } | null,
  despues: { decision: string; data_quality: number; razones: string[]; deriva: string | null; seleccion: string | null; edge: number | null },
  partido: string,
): Disparo[] {
  const out: Disparo[] = [];
  if (despues.decision === 'BET' && antes?.decision !== 'BET') {
    out.push({ type: 'edge_umbral', severity: 'importante', title: `${partido}: pasa a BET`, body: `${despues.seleccion ?? ''} con ventaja ${despues.edge == null ? '—' : pp(despues.edge)}, y supera los criterios de confianza.` });
  }
  if (antes && antes.data_quality - despues.data_quality >= 20) {
    out.push({ type: 'calidad_datos_baja', severity: 'aviso', title: `${partido}: la calidad de datos baja`, body: `${antes.data_quality} → ${despues.data_quality} / 100` });
  }
  const viejo = despues.razones.find((r) => r.startsWith('precio de hace'));
  if (viejo) out.push({ type: 'cuotas_viejas', severity: 'aviso', title: `${partido}: cuotas viejas`, body: viejo });
  if (despues.deriva) out.push({ type: 'deriva', severity: 'importante', title: 'Deriva reciente del modelo', body: despues.deriva });
  return out;
}
