// Piezas de TennisDashboard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { type Meta, type UpcomingWithPrediction } from '../lib/api';

export function RefreshInfo({ meta }: { meta: Meta }) {
  const when = meta.oddsRefreshedAt ?? meta.updatedAt ?? meta.seededAt;
  const whenTxt = when
    ? new Date(when).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
  return (
    <p className="mt-1 text-[14px] text-(--ink-muted)">
      Odds actualizadas: {whenTxt}
      {meta.hasOddsKey
        ? meta.autoRefreshMinutes > 0
          ? ` · auto cada ${Math.round(meta.autoRefreshMinutes / 60)}h`
          : ''
        : ' · configura ODDS_API_KEY y corre npm run update-data para partidos reales'}
    </p>
  );
}

export function DataBadge({ meta }: { meta: Meta }) {
  // An empty database must never read as "datos reales" — that's how a failed
  // ingest ends up looking like a working install with nothing in it.
  if (meta.counts.matches === 0) {
    return (
      <span
        className="rounded-full bg-rose-900/40 px-3 py-1 text-[14px] font-medium text-rose-300 ring-1 ring-rose-500/40"
        title="La base de datos está vacía. Ejecuta npm run update-data (o npm run seed)."
      >
        sin datos
      </span>
    );
  }
  const isSeed = meta.dataSource === 'seed';
  return (
    <span
      className={`rounded-full px-3 py-1 text-[14px] font-medium ring-1 ${
        isSeed
          ? 'bg-amber-900/40 text-amber-300 ring-amber-500/40'
          : 'bg-emerald-900/40 text-emerald-300 ring-emerald-500/40'
      }`}
      title={
        isSeed
          ? 'Datos de demostración (sintéticos). Ejecuta "npm run update-data" para datos reales.'
          : 'Datos históricos reales (Jeff Sackmann).'
      }
    >
      {isSeed ? 'datos demo' : 'datos reales'} · {meta.counts.matches} partidos
    </span>
  );
}

/**
 * Por qué la lista de partidos es tan corta, cuando lo es.
 *
 * ===========================================================================
 * DOS OCHOS QUE NO SIGNIFICAN LO MISMO
 * ===========================================================================
 * La cabecera dice «58.367 partidos» y la lista enseña dos. Son dos cosas distintas y
 * nada en la pantalla lo decía: el archivo histórico es nuestro y está completo, pero los
 * PRÓXIMOS salen de las casas de apuestas, y una casa publica un partido de tenis con
 * pocos días de antelación y solo cuando le pone precio.
 *
 * Así que dos partidos suele ser lo correcto, no un fallo: a mitad de un Grand Slam hay
 * un solo torneo activo y en las rondas finales le quedan dos o cuatro partidos. Pero sin
 * decirlo se lee como que la app no ha cargado, y la reacción natural es volver a correr
 * la actualización — que gasta cuota y devuelve los mismos dos.
 *
 * Solo aparece con la lista corta. En una semana normal, con seis torneos a la vez, esto
 * sería un párrafo de relleno encima de treinta tarjetas.
 */
export function ShortSlateNote({
  matches,
  meta,
}: {
  matches: UpcomingWithPrediction[];
  meta: Meta | null;
}) {
  // Seis: por debajo de eso la lista cabe de un vistazo y la pregunta «¿esto es todo?» se
  // la hace cualquiera.
  if (matches.length === 0 || matches.length >= 6) return null;
  const todosDemo = matches.every((m) => m.match.source === 'fixture');
  const torneos = [...new Set(matches.map((m) => m.match.tournament_name).filter(Boolean))];

  return (
    <p className="mb-4 text-[13px] leading-relaxed text-(--ink-muted)">
      {matches.length === 1 ? 'Un solo partido' : `Solo ${matches.length} partidos`}
      {torneos.length === 1 ? ` (${torneos[0]})` : ''}:{' '}
      {todosDemo ? (
        <DemoReason meta={meta} />
      ) : (
        <>
          los próximos los publican las casas, con pocos días de antelación y solo cuando
          les ponen precio. A mitad de un Grand Slam hay un único torneo activo y en las
          rondas finales quedan dos o cuatro partidos, así que esto suele ser lo que hay y
          no una carga a medias. El archivo histórico —el de la cabecera— es aparte y está
          completo. <strong className="text-(--ink-soft)">Volver a actualizar gasta cuota y
          devolverá los mismos.</strong>
        </>
      )}
    </p>
  );
}

/**
 * Por qué son de demostración, dicho con la causa REAL.
 *
 * ===========================================================================
 * LA VERSIÓN ANTERIOR DABA UN CONSEJO FALSO DOS DE CADA TRES VECES
 * ===========================================================================
 * Decía siempre «pon tu clave en ODDS_API_KEY». Pero la app cae a cuotas de demostración
 * por tres motivos distintos, y solo en uno falta la clave:
 *
 *   sin_clave     falta ODDS_API_KEY.
 *   fuente_falla  la clave está, pero el proveedor no contestó — cuota agotada, clave
 *                 inválida o sin internet.
 *   sin_eventos   todo bien, pero no hay tenis en juego. Entre torneos no hay nada que
 *                 publicar, y no hay nada que arreglar.
 *
 * Mandar a revisar una clave que ya está puesta es peor que no decir nada: se pierde el
 * tiempo donde no está el problema y se acaba desconfiando de lo que dice la app.
 */
export function DemoReason({ meta }: { meta: Meta | null }) {
  const razon = meta?.oddsFallbackReason;

  if (razon === 'sin_eventos') {
    return (
      <>
        son de <strong className="text-(--ink-soft)">demostración</strong>, y{' '}
        <strong className="text-(--ink-soft)">no falta nada por tu parte</strong>: tu clave
        funciona, pero ahora mismo las casas no publican ningún partido de tenis. Entre
        torneos es lo normal. Cuando empiece el siguiente aparecerán solos — y mientras
        tanto la app enseña un calendario generado por el modelo para no quedarse vacía.
      </>
    );
  }
  if (razon === 'presupuesto') {
    // La única de las causas que NO se arregla esperando, y por eso va aparte: el
    // refresco automático seguirá frenado mañana y pasado.
    return (
      <>
        son de <strong className="text-(--ink-soft)">demostración</strong> porque la app se
        frenó sola para repartir el plan del mes —{' '}
        <strong className="text-(--ink-soft)">no llegó a preguntar</strong>. Esperar no lo
        cambia. <code>npm run odds</code> las pide saltándose el freno.
      </>
    );
  }
  if (razon === 'fuente_falla') {
    return (
      <>
        son de <strong className="text-(--ink-soft)">demostración</strong> porque el proveedor
        de cuotas no contestó.{' '}
        <strong className="text-(--ink-soft)">Tu clave está puesta</strong>, así que suele ser
        la cuota del mes agotada o falta de conexión. <code>npm run doctor</code> lo dice
        sin gastar ni una petición.
        {meta?.oddsFallbackDetail && (
          <span className="block opacity-70">último error: {meta.oddsFallbackDetail}</span>
        )}
      </>
    );
  }
  if (razon === 'sin_clave' || meta?.hasOddsKey === false) {
    return (
      <>
        son de <strong className="text-(--ink-soft)">demostración</strong>, generados por el
        propio modelo, porque no hay <code>ODDS_API_KEY</code>. Ponla en el fichero{' '}
        <code>.env</code> y corre <code>npm run update-data</code> para ver las de verdad.
      </>
    );
  }
  // Sin razón guardada: es una base anterior a que esto se registrara. Se dice lo que se
  // sabe y se manda al comando que lo averigua, en vez de adivinar una causa.
  return (
    <>
      son de <strong className="text-(--ink-soft)">demostración</strong>, generados por el
      propio modelo. <code>npm run doctor</code> dice por qué, sin gastar cuota.
    </>
  );
}
