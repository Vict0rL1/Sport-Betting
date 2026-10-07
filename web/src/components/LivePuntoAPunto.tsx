// Tenis en vivo punto a punto (Fase 8.4): «punto para…» y «deshacer» sobre el motor en vivo.
//
// El marcador avanza en el SERVIDOR (POST /api/live/avanzar, la misma regla que usa el motor): una
// segunda copia de cómo se cuenta un tiebreak o una ventaja en la pantalla acabaría discrepando.
// De cada punto se apunta quién sacaba y quién lo ganó, y de ahí salen solos los puntos al saque de
// hoy (la actualización bayesiana) y el último juego, con si fue break.
//
// No hay fuente de marcador en vivo gratuita y fiable: se teclea mirando el partido, y se dice.
import { useState } from 'react';
import { enviarJson } from '../lib/usarJson';
import { trasPunto, type Marcador, type Recuento, type UltimoJuego } from '../lib/puntoAPunto';
import { useI18n } from '../i18n';

export type { Marcador, Recuento, UltimoJuego } from '../lib/puntoAPunto';

interface Paso {
  antes: Marcador;
  recuento: Recuento;
  ultimo: UltimoJuego | null;
}

export default function LivePuntoAPunto({
  marcador,
  recuento,
  ultimo,
  bestOf,
  names,
  onCambio,
}: {
  marcador: Marcador;
  recuento: Recuento;
  ultimo: UltimoJuego | null;
  bestOf: 3 | 5;
  names: [string, string];
  onCambio: (m: Marcador, r: Recuento, u: UltimoJuego | null) => void;
}) {
  const [historial, setHistorial] = useState<Paso[]>([]);
  const [terminado, setTerminado] = useState<1 | 2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { t } = useI18n();

  const punto = async (ganador: 1 | 2) => {
    setOcupado(true);
    setError(null);
    try {
      const inTiebreak = marcador.games[0] === 6 && marcador.games[1] === 6;
      const r = await enviarJson<{ terminado: boolean; ganador: 1 | 2 | null; state: (Marcador & { bestOf: number }) | null }>('/api/live/avanzar', 'POST', {
        state: { ...marcador, bestOf, inTiebreak },
        winner: ganador,
      });
      const n = r.terminado || !r.state ? null : { sets: r.state.sets, games: r.state.games, points: r.state.points, server: r.state.server };
      const tras = trasPunto(marcador, recuento, ultimo, ganador, n);
      setHistorial((h) => [...h, { antes: marcador, recuento, ultimo }]);
      if (!n) setTerminado(r.ganador);
      onCambio(n ?? marcador, tras.recuento, tras.ultimo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const deshacer = () => {
    const p = historial[historial.length - 1];
    if (!p) return;
    setHistorial((h) => h.slice(0, -1));
    setTerminado(null);
    onCambio(p.antes, p.recuento, p.ultimo);
  };

  return (
    <div className="mb-3 rounded-lg border border-(--line) p-3" data-testid="punto-a-punto">
      <p className="mb-2 text-[12px] text-(--ink-muted)">
        {t('pap.intro')}
      </p>
      <div className="flex flex-wrap gap-2">
        {([1, 2] as const).map((j) => (
          <button
            key={j}
            disabled={ocupado || terminado != null}
            onClick={() => void punto(j)}
            className="rounded-lg bg-(--raised-2) px-3 py-2 text-[14px] font-medium text-(--ink-strong) ring-1 ring-inset ring-(--line-strong) hover:bg-(--raised-3) disabled:opacity-50"
          >
            {t('pap.puntoPara', { nombre: names[j - 1] })}
          </button>
        ))}
        <button
          disabled={ocupado || historial.length === 0}
          onClick={deshacer}
          className="rounded-lg px-3 py-2 text-[14px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised) disabled:opacity-50"
        >
          {t('pap.deshacer')}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-(--ink-muted)">
        {t('pap.apuntados', { n: historial.length })}
        {ultimo ? `${t('pap.ultimoJuego', { nombre: names[ultimo.winner - 1] })}${ultimo.wasBreak ? t('pap.break') : ''}` : ''}
      </p>
      {terminado != null && <p className="mt-1 text-[13px] font-semibold text-(--ink-strong)">{t('pap.terminado', { nombre: names[terminado - 1] })}</p>}
      {error && <p className="mt-1 text-[13px] text-(--ink-soft)" role="alert">{error}</p>}
    </div>
  );
}
