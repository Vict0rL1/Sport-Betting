// Piezas compartidas de la interfaz: slate. Partido de ui/index.tsx en la Fase 5 (ningún import cambia: index.tsx reexporta).
import { useState } from 'react';
import type { SlateRow } from '../../lib/slate';
/**
 * LA TABLA DE PARTIDOS: qué se juega y qué dice el modelo, haya precios o no.
 * ===========================================================================
 * `PicksPanel` es una tabla de MERCADOS ordenada por discrepancia con el precio, y se
 * retira entera cuando no hay ninguna discrepancia que enseñar. En la NFL eso pasa
 * siempre que las casas no han publicado línea, porque es el único deporte que no se
 * inventa cuotas: la pestaña se quedaba sin vista de conjunto y parecía que faltaba algo.
 *
 * Esta contesta otra pregunta, y una que no depende de las cuotas: «¿qué hay y a quién
 * ve favorito el modelo?». Por eso las dos columnas de mercado son opcionales por
 * diseño. Cuando no hay precio dicen «—», que es una respuesta; una tabla que no aparece
 * no lo es.
 *
 * Va DEBAJO del panel de discrepancias y ENCIMA de las tarjetas: resume lo que las
 * tarjetas detallan, y quien quiera el desglose de un partido lo abre ahí.
 */
/**
 * Hace cuánto se pidieron los precios, en palabras, o null si nunca.
 *
 * ===========================================================================
 * UNA LISTA CONGELADA TIENE QUE VERSE CONGELADA
 * ===========================================================================
 * Cuando el refresco automático se para —plan agotado, freno de ritmo, la app cerrada—
 * la tabla sigue ahí con las mismas cuotas y el mismo aspecto de estar al día. No hay
 * nada en la pantalla que distinga un precio de hace diez minutos de uno de hace dos
 * días, y esa es justo la diferencia que decide si una cuota sirve para algo.
 *
 * El umbral son SEIS HORAS y no una: con el plan gratuito un ciclo cabe cada pocos días,
 * así que marcar en ámbar a la hora teñiría de aviso el funcionamiento normal, y un
 * aviso permanente se deja de leer.
 */
function edadPrecios(iso: string | null | undefined): { texto: string; viejo: boolean } | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60_000);
  const texto =
    min < 60
      ? `hace ${min} min`
      : min < 1440
        ? `hace ${Math.round(min / 60)} h`
        : `hace ${Math.round(min / 1440)} día${Math.round(min / 1440) === 1 ? '' : 's'}`;
  return { texto, viejo: ms > 6 * 3600_000 };
}

export function SlateTable({
  rows,
  demoOdds = false,
  maxRows = 12,
  refrescadas,
  bands,
}: {
  rows: SlateRow[];
  /** Los precios existen pero se los ha inventado la app: la columna no dice nada. */
  demoOdds?: boolean;
  maxRows?: number;
  /** Cuándo se pidieron por última vez las cuotas de este deporte. */
  refrescadas?: string | null;
  /** Acierto medido por umbral de confianza, para que el filtro no prometa de más. */
  bands?: { desde: number; n: number; acierto: number }[] | null;
}) {
  const [open, setOpen] = useState(true);
  const [todas, setTodas] = useState(false);
  // ===========================================================================
  // EL FILTRO DE CONFIANZA
  // ===========================================================================
  // «Enséñame solo los partidos claros» es una petición razonable y tiene una respuesta
  // buena: el modelo acierta el 65 % de TODO, y el 87 % de aquello en lo que dice 80 % o
  // más. No es un modelo mejor, es el mismo modelo sobre menos partidos — y lo que se
  // paga es cobertura: ese 87 % vive en el 13 % de los partidos.
  //
  // Por eso el umbral SIEMPRE va acompañado del acierto medido y del número de partidos
  // sobre el que se midió. Un filtro que solo enseña la lista insinúa que filtrar por 80
  // garantiza acertar el 80, y eso solo es cierto si el modelo está calibrado ahí —
  // cosa que aquí está medida, y por eso se puede decir.
  // «Todos» es CERO, no 0,5. La primera versión arrancaba en 0,5 creyendo que el
  // favorito siempre pasa de la mitad, y eso solo es cierto con dos resultados. En el
  // fútbol hay empate: el favorito suele rondar el 40 %, así que la vista por defecto
  // escondía cinco de cada seis partidos con «todos» marcado. Medido en pantalla:
  // cabecera «6 partidos», tabla con 1 fila.
  const [umbral, setUmbral] = useState(0);
  if (rows.length === 0) return null;

  // La banda EXACTA del umbral, no «la más alta por debajo». Béisbol no tiene banda del
  // 80 %: su modelo casi nunca llega ahí y no hay partidos para medirlo. Con la búsqueda
  // anterior, «80 %+» en béisbol habría enseñado el acierto del 70 %+ como si fuera el
  // suyo — un número medido sobre otros partidos, puesto bajo un filtro que no lo es.
  const banda = bands?.find((b) => Math.abs(b.desde - umbral) < 1e-9) ?? null;
  const orden = [...rows]
    .filter((r) => r.pickProb >= umbral)
    .sort((a, b) => a.when.localeCompare(b.when));
  const vistas = todas ? orden : orden.slice(0, maxRows);
  const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
  // Un mercado inventado por la app NO es un mercado. Se trata igual que no tener
  // ninguno en vez de enseñar un número que solo puede confundir.
  const hayMercado = !demoOdds && orden.some((r) => r.marketProb != null);
  const edad = edadPrecios(refrescadas);

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-white/[0.09] bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold text-[#e8eaed]">Los partidos</span>
          <span className="block text-[13px] text-[#7b828d]">
            {rows.length === 1 ? '1 partido' : `${rows.length} partidos`} · a quién ve favorito el
            modelo
            {hayMercado ? ' y qué dice el mercado' : ''}
            {/* La edad de los precios, solo cuando hay precios de verdad que fechar. */}
            {hayMercado && edad && (
              <>
                {' · '}
                <span style={edad.viejo ? { color: '#d9a441' } : undefined}>
                  precios {edad.texto}
                  {edad.viejo ? ' — puede que ya no valgan' : ''}
                </span>
              </>
            )}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-[#7b828d]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-white/[0.07]">
          {/* El scroll horizontal vive en la tabla, nunca en la página: una fila ancha no
              puede empujar el resto de la pantalla de lado en un móvil. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[14px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#7b828d]">
                  <th className="px-4 py-2 font-medium">Cuándo</th>
                  <th className="px-4 py-2 font-medium">Partido</th>
                  <th className="px-4 py-2 font-medium">Favorito del modelo</th>
                  <th className="px-4 py-2 text-right font-medium">Mercado</th>
                  <th className="px-4 py-2 text-right font-medium">Cuota</th>
                </tr>
              </thead>
              <tbody>
                {vistas.map((r) => {
                  const dif = r.marketProb != null ? r.pickProb - r.marketProb : null;
                  return (
                    <tr key={r.id} className="border-t border-white/[0.05]">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[#9aa1ac]">
                        {new Date(r.when).toLocaleString('es', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5 text-[#c3c9d1]">{r.match}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[#e8eaed]">{r.pick}</span>{' '}
                        <span className="font-semibold text-[#e8eaed]">{pct(r.pickProb)}</span>
                        {r.drawProb != null && (
                          <span className="block text-[12px] text-[#7b828d]">
                            empate {pct(r.drawProb)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-[#9aa1ac]">
                        {r.marketProb == null ? (
                          <span className="text-[#5c636e]">—</span>
                        ) : (
                          <>
                            {pct(r.marketProb)}
                            {dif != null && Math.abs(dif) >= 0.04 && (
                              <span className="block text-[12px] text-[#7b828d]">
                                {dif > 0 ? '+' : ''}
                                {(dif * 100).toFixed(1)} pp
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-[#9aa1ac]">
                        {r.odds == null ? <span className="text-[#5c636e]">—</span> : r.odds.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* El control del umbral, con lo que cuesta y lo que da, los dos medidos. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-4 py-2.5">
            <span className="text-[13px] text-[#7b828d]">Solo los que el modelo ve claros:</span>
            {[0, 0.6, 0.7, 0.8].map((u) => (
              <button
                key={u}
                onClick={() => setUmbral(u)}
                className={`rounded-full px-2.5 py-1 text-[13px] transition ${
                  umbral === u ? 'bg-white/[0.08] text-[#e8eaed]' : 'text-[#9aa1ac] hover:bg-white/[0.04]'
                }`}
              >
                {u === 0 ? 'todos' : `${u * 100}%+`}
              </button>
            ))}
            {umbral > 0 && (
              <span className="text-[13px] text-[#7b828d]">
                {/* Con la lista vacía no hay «estos» de los que acertar un porcentaje.
                    Decir «acierta el 87 % de estos» sobre cero partidos es una frase
                    sin referente, y de las que se leen como si prometieran algo. */}
                {orden.length === 0
                  ? `ninguno de los ${rows.length} de hoy llega a ese umbral`
                  : `${orden.length} de ${rows.length}`}
                {banda
                  ? orden.length === 0
                    ? ` · cuando los hay, el modelo acierta el ${(banda.acierto * 100).toFixed(0)} %, medido sobre ${banda.n.toLocaleString('es')} partidos`
                    : ` · el modelo acierta el ${(banda.acierto * 100).toFixed(0)} % de estos, medido sobre ${banda.n.toLocaleString('es')} partidos`
                  : bands?.length
                    ? ' · el modelo casi nunca llega tan alto en este deporte: no hay partidos suficientes para medir su acierto ahí'
                    : ' · sin acierto medido por banda en este deporte'}
              </span>
            )}
          </div>

          {orden.length > maxRows && (
            <button
              onClick={() => setTodas(!todas)}
              className="w-full border-t border-white/[0.05] px-4 py-2.5 text-[13px] text-[#9aa1ac] transition hover:bg-white/[0.03]"
            >
              {todas ? 'Ver solo los próximos' : `Ver los ${orden.length} partidos`}
            </button>
          )}

          {/* Por qué las dos últimas columnas están vacías. Sin esta línea, un guion en
              todas las filas se lee como que la app no ha cargado algo. */}
          {!hayMercado && (
            <p className="border-t border-white/[0.05] px-4 py-2.5 text-[13px] leading-relaxed text-[#7b828d]">
              Sin columna de mercado:{' '}
              {demoOdds
                ? 'las cuotas que hay se las ha inventado la app, así que compararlas con el modelo sería compararlo consigo mismo.'
                : 'las casas no han publicado precio para estos partidos. El calendario y la probabilidad del modelo no dependen de eso.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * POR QUÉ ESTA PESTAÑA ESTÁ VACÍA, CUANDO LO ESTÁ A PROPÓSITO
 * ===========================================================================
 * Con `DEMO_FIXTURES=off` la app deja de inventarse partidos, que es lo que se le ha
 * pedido. Pero una pestaña vacía se parece muchísimo a una pestaña rota: no hay forma de
 * distinguir «no hay nada que enseñar» de «no ha cargado» mirándola.
 *
 * Un vacío deliberado tiene que decir que es deliberado, y decir qué falta para que deje
 * de estarlo. Esto es lo que separa apagar la demostración —una decisión— de que la app
 * parezca averiada.
 */
export function VacioPorqueNoHayCuotas({
  reason,
  detail,
  hasKey,
  demoFixtures,
}: {
  reason: string | null | undefined;
  detail?: string | null;
  hasKey: boolean;
  demoFixtures: boolean;
}) {
  // Con la demostración encendida, un vacío significa otra cosa (no hay datos del
  // deporte) y lo explica `EmptySlate`. Esta nota es solo para el vacío deliberado.
  if (demoFixtures) return null;

  return (
    <div className="mb-6 rounded-xl border border-white/[0.09] bg-white/[0.02] px-4 py-4 text-[14px] leading-relaxed text-[#9aa1ac]">
      <p className="mb-2 text-[15px] font-semibold text-[#e8eaed]">
        No hay partidos con cuotas reales ahora mismo
      </p>
      <p>
        Y esta pestaña está vacía <strong className="text-[#c3c9d1]">a propósito</strong>: has
        apagado los partidos de demostración, así que la app no se inventa nada para llenar el
        hueco.{' '}
        {reason === 'sin_eventos'
          ? 'Las casas no tienen precio publicado para ninguna de las competiciones configuradas. Entre jornadas es lo normal.'
          : reason === 'sin_ligas'
            ? 'El proveedor no ofrece ninguna de las competiciones configuradas ahora mismo.'
            : reason === 'presupuesto'
              ? 'La app se frenó sola para repartir el plan del mes y no llegó a preguntar — esto NO se arregla esperando: npm run odds las pide saltándose el freno.'
              : reason === 'fuente_falla'
                ? 'El proveedor de cuotas no contestó: cuota del mes agotada, clave inválida o sin conexión.'
                : reason === 'sin_clave' || !hasKey
                  ? 'Falta ODDS_API_KEY en el .env de la raíz.'
                  : 'Sin causa registrada; npm run doctor la desglosa sin gastar cuota.'}
      </p>
      {detail && (
        <p className="mt-2 text-[13px] opacity-70">
          <span className="font-mono">{detail}</span>
        </p>
      )}
      <p className="mt-3 text-[13px] text-[#7b828d]">
        El modelo, los Elo y el historial siguen ahí y son reales — lo que falta son los precios
        con los que compararlos. Para volver a tener partidos de relleno:{' '}
        <code>npm run demo -- --on</code>
      </p>
    </div>
  );
}
