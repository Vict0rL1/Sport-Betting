// ¿Cuánto fiarse de ESTA predicción? La respuesta de la capa de confianza
// (server/src/trust), con sus razones, y lo que el modelo decía antes del partido.
//
// No es «una nota»: cada pieza dice qué mide y con qué criterio, y lo que la app no sabe
// aparece como desconocido. La decisión BET / NO BET es la misma que aplica el banco de
// papel.

import { useEffect, useState } from 'react';
import { LOSS_COLOR, PROFIT_COLOR } from '../../lib/theme';
import type { EvaluacionConfianza, PrePartido, PrePartidoRef } from '../../lib/trust';

const pct = (p: number) => `${(p * 100).toFixed(1).replace('.', ',')} %`;
const pp = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1).replace('.', ',')} pp`;
const AMBAR = '#d9a441';
const GRIS = '#7b828d';

const COLOR: Record<string, string> = {
  ALTA: PROFIT_COLOR, BAJO: PROFIT_COLOR, BET: PROFIT_COLOR,
  MEDIA: AMBAR, MEDIO: AMBAR,
  BAJA: LOSS_COLOR, ALTO: LOSS_COLOR, 'NO BET': LOSS_COLOR,
  'SIN MERCADO': GRIS, 'SIN DATOS': GRIS, 'SIN COMPONENTES': GRIS,
};

function Etiqueta({ texto }: { texto: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide" style={{ color: COLOR[texto] ?? GRIS, border: `1px solid ${COLOR[texto] ?? GRIS}55` }}>
      {texto}
    </span>
  );
}

function Fila({ titulo, valor, children }: { titulo: string; valor: React.ReactNode; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-white/[0.05] py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left text-[13px]" aria-expanded={open}>
        <span className="text-[#9aa1ac]">{titulo}</span>
        <span className="flex items-center gap-2 text-[#c3c9d1]">
          {valor}
          {children && <span className="text-[#5c636c]">{open ? '▲' : '▼'}</span>}
        </span>
      </button>
      {open && children && <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-[#9aa1ac]">{children}</div>}
    </div>
  );
}

const ICONO = { ok: '✓', aviso: '⚠', desconocido: '?' } as const;
const COLOR_ICONO = { ok: PROFIT_COLOR, aviso: AMBAR, desconocido: GRIS } as const;

function HistorialPrePartido({ refP }: { refP: PrePartidoRef }) {
  const [d, setD] = useState<PrePartido | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/prematch/${refP.sport}/${encodeURIComponent(refP.matchKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: PrePartido) => vivo && setD(j))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [refP.sport, refP.matchKey]);
  if (error) return <p>No se pudo leer el historial pre-partido.</p>;
  if (!d) return <p>Cargando…</p>;
  if (!d.instantaneas) return <p>Aún no hay instantáneas de este partido: se toman cada 15 minutos con el servidor en marcha.</p>;
  const nombre = d.horizontes.find((h) => h.fila)?.fila?.outcomes[0] ?? '';
  return (
    <>
      <p>Probabilidad de {nombre}, tal como estaba a cada hora (lo último capturado ANTES de cada marca):</p>
      <ul>
        {d.horizontes.map((h) => (
          <li key={h.etiqueta}>
            <span className="text-[#c3c9d1]">{h.etiqueta}:</span>{' '}
            {h.fila ? `${pct(h.fila.probs[0])}${h.minutosAntesDeLaMarca && h.minutosAntesDeLaMarca > 90 ? ` (capturada ${Math.round(h.minutosAntesDeLaMarca / 60)} h antes de la marca)` : ''}` : 'sin observación anterior a esa hora'}
          </li>
        ))}
      </ul>
      {d.final && <p>Final pre-partido CONGELADA ({d.final.source === 'snapshot' ? 'última instantánea' : 'registro de predicciones'}): {pct(d.final.probs[0])}.</p>}
      {d.cambios.length > 0 && (
        <>
          <p className="mt-1">Cambios:</p>
          <ul>
            {d.cambios.map((c, i) => (
              <li key={i}>
                {pp(c.deltaPp[0])} · {c.causas.length ? c.causas.join('; ') : ''} <span className="text-[#5c636c]">({c.atribucion})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function LineaTemporal({ refP }: { refP: PrePartidoRef }) {
  const [d, setD] = useState<{ hitos: { at: string; tipo: string; texto: string }[]; nota: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/timeline/${refP.sport}/${encodeURIComponent(refP.matchKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => vivo && setD(j))
      .catch(() => vivo && setD({ hitos: [], nota: 'No se pudo leer la línea temporal.' }));
    return () => {
      vivo = false;
    };
  }, [refP.sport, refP.matchKey]);
  if (!d) return <p>Cargando…</p>;
  return (
    <>
      {d.hitos.map((h, i) => (
        <p key={i}>
          <span className="text-[#5c636c]">{new Date(h.at).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> {h.texto}
        </p>
      ))}
      <p className="text-[#5c636c]">{d.nota}</p>
    </>
  );
}

export default function EventTrustPanel({ confianza, prePartido }: { confianza?: EvaluacionConfianza | null; prePartido?: PrePartidoRef | null }) {
  const [open, setOpen] = useState(false);
  if (!confianza) return null;
  const c = confianza;
  const top = c.probs.indexOf(Math.max(...c.probs));
  return (
    <div className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.015] px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open}>
        <span className="text-[14px] font-medium text-[#c3c9d1]">¿Cuánto fiarse?</span>
        <span className="flex flex-wrap items-center justify-end gap-1.5 text-[12px] text-[#9aa1ac]">
          confianza <Etiqueta texto={c.confianza.nivel} /> <Etiqueta texto={c.decision.decision} />
          <span className="text-[#5c636c]">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2">
          <p className="text-[13px] text-[#c3c9d1]">
            {c.outcomes[top]}: {pct(c.probs[top])} · rango razonable {pct(c.incertidumbre.rango.bajo)} – {pct(c.incertidumbre.rango.alto)}
          </p>
          {c.decision.seleccion && (
            <p className="text-[12px] text-[#9aa1ac]">
              Mejor selección: {c.decision.seleccion.nombre} a {c.decision.seleccion.cuota.toFixed(2)} · ventaja {pct(c.decision.seleccion.edge)}
              {c.decision.desaparece != null && ` · desaparece en el ${Math.round(c.decision.desaparece * 100)} % de las simulaciones`}
            </p>
          )}
          <div className="mt-1 text-[12px] leading-relaxed">
            {c.decision.decision === 'NO BET' && (
              <>
                <p style={{ color: LOSS_COLOR }}>NO BET. Razones:</p>
                <ul className="text-[#9aa1ac]">{c.decision.razones.map((r) => <li key={r}>– {r}</li>)}</ul>
                <p className="mt-1 text-[#9aa1ac]">Para apostar haría falta: {c.decision.contrafactual.join('; ')}.</p>
              </>
            )}
            {c.decision.decision === 'BET' && (
              <>
                {c.decision.razones.length > 0 && <ul className="text-[#9aa1ac]">{c.decision.razones.map((r) => <li key={r}>– {r}</li>)}</ul>}
                <p className="text-[#9aa1ac]">La apuesta deja de cumplir los criterios si: {c.decision.contrafactual.join('; o ')}.</p>
              </>
            )}
            {c.decision.decision === 'SIN MERCADO' && <p className="text-[#9aa1ac]">{c.decision.razones.join(' · ')}</p>}
          </div>

          <div className="mt-2">
            <Fila titulo="Confianza" valor={<Etiqueta texto={c.confianza.nivel} />}>
              {c.confianza.porQue.map((s) => (
                <p key={s.texto}><span style={{ color: s.ok ? PROFIT_COLOR : AMBAR }}>{s.ok ? '✓' : '⚠'}</span> {s.texto}</p>
              ))}
              <p className="text-[#5c636c]">{c.confianza.criterio}</p>
            </Fila>
            <Fila titulo="Calidad de datos" valor={`${c.calidadDatos.puntuacion} / 100`}>
              {c.calidadDatos.items.map((i) => (
                <p key={i.texto}>
                  <span style={{ color: COLOR_ICONO[i.estado] }}>{ICONO[i.estado]}</span> {i.texto}
                  {i.estado === 'desconocido' ? <span className="text-[#5c636c]"> (DESCONOCIDO)</span> : <span className="text-[#5c636c]"> ({i.puntos}/{i.max})</span>}
                </p>
              ))}
              <p className="text-[#5c636c]">{c.calidadDatos.explicacion}</p>
            </Fila>
            <Fila titulo="Incertidumbre" valor={`±${c.incertidumbre.totalPp.toFixed(1).replace('.', ',')} pp`}>
              <p>Ruido de rating: ±{c.incertidumbre.ruidoRatingPp} pp</p>
              <p>{c.incertidumbre.sesgoCalibracionPp == null ? 'Sin calibración medida para este tramo.' : `Sesgo histórico del tramo: ${pp(c.incertidumbre.sesgoCalibracionPp)} (n ${c.incertidumbre.nTramo})`}</p>
              <p className="text-[#5c636c]">{c.incertidumbre.significado}</p>
            </Fila>
            <Fila titulo="Estabilidad" valor={<Etiqueta texto={c.estabilidad.nivel} />}>
              <p>Escenarios: {c.estabilidad.escenarios.map((e) => pct(e.p)).join(' · ')}</p>
              <ul>{c.estabilidad.escenarios.map((e) => <li key={e.texto}>{pct(e.p)} — {e.texto}</li>)}</ul>
              <p>Percentiles 10–90 de las simulaciones: {pct(c.estabilidad.p10)} – {pct(c.estabilidad.p90)}</p>
              {c.estabilidad.supuestos.map((s) => <p key={s}>· {s}</p>)}
              <p className="text-[#5c636c]">{c.estabilidad.criterio}</p>
            </Fila>
            <Fila titulo="Desacuerdo entre componentes" valor={<Etiqueta texto={c.desacuerdo.nivel} />}>
              {c.desacuerdo.componentes.map((k) => <p key={k.nombre}>{k.nombre}: {pct(k.p)}</p>)}
              <p className="text-[#5c636c]">{c.desacuerdo.criterio}</p>
            </Fila>
            <Fila titulo="Qué mueve la predicción" valor={c.sensibilidad.exacta ? 'exacto' : 'aproximado'}>
              <p>Sin ningún factor: {pct(c.sensibilidad.base)} ({c.outcomes[0]})</p>
              {c.sensibilidad.contribuciones.map((k) => <p key={k.etiqueta}>{k.etiqueta}: {pp(k.pp)}</p>)}
              <p>Final: {pct(c.sensibilidad.final)}</p>
              <p className="text-[#5c636c]">{c.sensibilidad.metodo}</p>
            </Fila>
            <Fila titulo="Calidad de mercado (proxy)" valor={<Etiqueta texto={c.mercado.calidad} />}>
              {c.mercado.lineas.map((l, i) => {
                // La ventaja con cada cuota, con la probabilidad del modelo para esa selección.
                const p = c.probs[i];
                const ev = (o: number) => pp((p * o - 1) * 100);
                return (
                  <p key={l.seleccion}>
                    {l.seleccion}: mejor {l.mejor.toFixed(2)} ({l.mejorCasa}, ventaja {ev(l.mejor)}) · mediana {l.mediana.toFixed(2)} ({ev(l.mediana)}) · peor{' '}
                    {l.peor.toFixed(2)} ({ev(l.peor)}) · {l.casas} casas · dispersión {l.dispersionPp} pp
                  </p>
                );
              })}
              {c.mercado.lineas.length > 0 && <p className="text-[#5c636c]">La mejor cuota es una cota superior: no siempre se puede apostar en todas las casas.</p>}
              {c.mercado.ultimaActualizacionMin != null && <p>Última observación: hace {c.mercado.ultimaActualizacionMin} min · {c.mercado.observaciones24h} descargas en 24 h</p>}
              {c.mercado.motivos.map((m) => <p key={m}>⚠ {m}</p>)}
              <p className="text-[#5c636c]">{c.mercado.etiqueta}.</p>
            </Fila>
            <Fila titulo="Fuera de distribución" valor={c.ood.length ? `${c.ood.length} aviso(s)` : 'no'}>
              {c.ood.length ? c.ood.map((o) => <p key={o.texto}>⚠ {o.texto}{o.grave ? ' (grave)' : ''}</p>) : <p>Nada fuera de lo que el modelo ha visto.</p>}
            </Fila>
            <Fila titulo="Régimen" valor={c.regimen.etiqueta}>
              {c.regimen.nota && <p>{c.regimen.nota}</p>}
              <p>Deriva reciente: {c.deriva}</p>
            </Fila>
            {prePartido && (
              <Fila titulo="Historial pre-partido" valor="T-24h → final">
                <HistorialPrePartido refP={prePartido} />
              </Fila>
            )}
            {prePartido && (
              <Fila titulo="Línea temporal de auditoría" valor="hechos guardados">
                <LineaTemporal refP={prePartido} />
              </Fila>
            )}
            <p className="mt-1 text-[11px] text-[#5c636c]">{c.nota}</p>
          </div>
        </div>
      )}
    </div>
  );
}
