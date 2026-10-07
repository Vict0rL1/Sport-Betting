// Inteligencia de mercado en Destacados (aproximación).
import { useEffect, useState } from 'react';
import { PROFIT_COLOR } from '../../lib/theme';
import { StatusMark } from '../icons';
import { type Inteligencia, AMBAR, num } from './tipos';

export function Mercado() {
  const [d, setD] = useState<Inteligencia | null | 'error'>(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/odds/intel')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Inteligencia) => vivo && setD(j))
      .catch(() => vivo && setD('error'));
    return () => {
      vivo = false;
    };
  }, []);
  if (d === 'error') return null;
  return (
    <div className="mt-3 rounded-xl border border-(--line) p-4 text-[12px] leading-relaxed text-(--ink-muted)">
      <p className="mb-1.5 font-medium text-(--ink-soft)">Mercado (aproximación)</p>
      {!d && <p>Leyendo los precios observados…</p>}
      {d && d.eventos === 0 && <p>Sin cuotas observadas en las últimas {d.ventanaHoras} h: no hay nada que leer del mercado.</p>}
      {d && d.eventos > 0 && (
        <>
          <p>
            {d.eventos} mercado(s) con precio · {d.steam.length} movimiento(s) rápido(s) · {d.surebets.length} surebet(s) · {d.referencia.length} con referencia afilada
          </p>
          {d.steam.slice(0, 4).map((s) => (
            <p key={`${s.eventId}|${s.market}|${s.seleccion}`}>
              <StatusMark estado="aviso" color={AMBAR} />{s.partido}: {s.seleccion} {num(s.desde)} → {num(s.hasta)} en {s.minutos} min ({s.casas} casas,{' '}
              {s.movimientoPp > 0 ? '+' : '−'}{Math.abs(s.movimientoPp).toFixed(1).replace('.', ',')} pp)
            </p>
          ))}
          {d.surebets.slice(0, 3).map((s) => (
            <p key={`${s.eventId}|${s.market}`}>
              <StatusMark estado="ok" color={PROFIT_COLOR} />{s.partido}: surebet {s.margenPct.toFixed(1).replace('.', ',')} % ({s.patas.map((p) => `${p.seleccion} ${num(p.cuota)} en ${p.casa}`).join(', ')})
            </p>
          ))}
          {d.referencia.slice(0, 3).map((r) => (
            <p key={`${r.eventId}|${r.market}`}>
              {r.partido} frente a {r.casa}: {r.selecciones.map((s) => `${s.seleccion} ${s.desviacionPp > 0 ? '+' : '−'}${Math.abs(s.desviacionPp).toFixed(1).replace('.', ',')} pp`).join(' · ')}
            </p>
          ))}
          <p className="mt-1 text-(--ink-faint)">{d.etiqueta}</p>
        </>
      )}
    </div>
  );
}
