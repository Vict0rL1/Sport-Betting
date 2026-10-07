import type { ClimaFicha } from '../lib/clima';
import { TECHO } from '../lib/clima';
import { Panel, SectionTitle } from './ui';

/**
 * El clima del partido, como información: la previsión más reciente (T-24h → T-1h) o lo
 * observado después. Nunca mueve la probabilidad publicada; cuando no hay dato, lo dice y por
 * qué, en vez de enseñar una casilla vacía que parece un cero.
 */
export function ClimaPanel({ clima }: { clima: ClimaFicha | null | undefined }) {
  if (!clima) return null;
  const techo = clima.estadio ? TECHO[clima.estadio.techo] : null;
  const derecha = clima.estado === 'DESCONOCIDO' ? 'sin dato' : clima.estado === 'observado' ? 'observado tras el partido' : `previsión a ${clima.horizonte}`;
  return (
    <Panel>
      <SectionTitle right={derecha}>Clima</SectionTitle>
      {clima.estado === 'DESCONOCIDO' ? (
        <p className="text-[13px] text-(--ink-muted)">
          DESCONOCIDO{clima.motivo ? ` · ${clima.motivo}` : ''}
          {clima.estadio ? ` · ${clima.estadio.nombre} (${techo})` : ''}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-(--ink-muted)">Temperatura</dt>
            <dd className="text-(--ink-strong)">{clima.tempC == null ? '—' : `${Math.round(clima.tempC)} °C`}</dd>
          </div>
          <div>
            <dt className="text-(--ink-muted)">Viento</dt>
            <dd className="text-(--ink-strong)">{clima.vientoMph == null ? '—' : `${Math.round(clima.vientoMph)} mph`}</dd>
          </div>
          <div>
            <dt className="text-(--ink-muted)">Lluvia</dt>
            <dd className="text-(--ink-strong)">
              {clima.probLluvia != null ? `${Math.round(clima.probLluvia)} %` : clima.lluviaMm != null ? `${clima.lluviaMm.toFixed(1)} mm` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-(--ink-muted)">Cielo</dt>
            <dd className="text-(--ink-strong)">{clima.descripcion ?? '—'}</dd>
          </div>
        </dl>
      )}
      {clima.estadio && clima.estado !== 'DESCONOCIDO' && (
        <p className="mt-1.5 text-[12px] text-(--ink-faint)">
          {clima.estadio.nombre}, {clima.estadio.ciudad} · {techo}
          {clima.estadio.techo !== 'outdoors' ? ' · con el techo cerrado el viento no entra en juego' : ''} · solo informativo: no cambia la probabilidad
        </p>
      )}
    </Panel>
  );
}
