// Página de partido (Fase 5.11): el destino para compartir. La tarjeta del deporte (con su
// desglose, la matriz de marcadores o el clima donde existen, y la capa de confianza con el
// «qué pasaría si»), la deriva pre-partido T-24h → final, el movimiento de cuotas por casa y
// «¿Acertó?» cuando hay resultado. El ?clave= permite abrirla aunque el partido ya no esté en
// la lista de próximos.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import FootballCard from '../components/football/MatchCard';
import BasketballCard from '../components/basketball/GameCard';
import BaseballCard from '../components/baseball/GameCard';
import NflCard from '../components/nfl/GameCard';
import NhlCard from '../components/nhl/GameCard';
import UfcCard from '../components/ufc/FightCard';
import TennisCard from '../components/MatchCard';
import { LineChart } from '../components/charts';
import { EstrellaSeguir } from '../components/seguimiento';
import { useGuardadas } from '../components/guardadas';
import { estaGuardada } from '../lib/remoto';
import { aComun, nombrePartido, puedeTenerResultado, URL_PARTIDO, type DeporteId, type PartidoComun } from '../lib/partidos';
import { rutaEquipo, rutaJugador, rutaLuchador, rutaPartido, RUTA_DE_PESTANA } from '../rutas';
import { avisoSinDeriva, nombreDelPrePartido, type PrePartido } from '../lib/trust';
import { resumirHistorial } from '../lib/historial';
import { CLAVE_BORRADOR } from '../components/picks/acciones';
import { useI18n, formato } from '../i18n';
import { PROFIT_COLOR, LOSS_COLOR } from '../lib/theme';
import { escribir } from '../lib/explicacion';

interface Resultado {
  casa: string;
  fuera: string;
  cuando: string | null;
  probabilidades: number[];
  resuelto: boolean;
  resultado: 'casa' | 'empate' | 'fuera' | null;
  marcador: string | null;
  probabilidadDada: number | null;
  acerto: boolean | null;
  /** Qué se puntuó (B1; falta en respuestas de antes). */
  evaluacion?: { politica: string; tipo: 'final' | 'legado' | null; fuente: 'instantanea' | 'registro' | null; capturadaEn: string | null; snapshotId: number | null; motivo: 'final-invalida' | 'publicacion-invalida' | 'sin-publicacion' | 'publicacion-tardia' | null };
}
interface PorCasa { casas: string[]; series: { casa: string; seleccion: string; puntos: { at: string; cuota: number }[] }[] }

const DEPORTES: DeporteId[] = ['football', 'basketball', 'baseball', 'nfl', 'nhl', 'ufc', 'tennis'];

/**
 * Guardar ESTA estimación para mirarla después (FAV-3): una referencia a la instantánea, distinta de
 * seguir el partido y de apuntar una apuesta. Lo que se ve es lo que el servidor tiene guardado.
 */
function GuardarEstimacion({ sport, matchKey, snapshotId }: { sport: string; matchKey: string; snapshotId: number }) {
  const { t } = useI18n();
  // Una lectura para toda la ficha (B3): el estado es el de la lista compartida.
  const { estado, guardar, quitar } = useGuardadas();
  const [accion, setAccion] = useState<'listo' | 'enviando' | 'error'>('listo');
  if (estado.fase === 'apagado' || estado.fase === 'inicial') return null;
  const guardada = estaGuardada(estado, sport, snapshotId);
  const clase = 'toque rounded px-1.5 text-[11px] underline-offset-2 [--toque-y:8px] hover:underline';
  // Todavía no se sabe: ni «Guardar» ni «Guardada».
  if (guardada === undefined && (estado.fase === 'cargando' || estado.fase === 'actualizando')) {
    return <span className="px-1.5 text-[11px] text-(--ink-faint)" aria-busy="true">{t('partido.guardadaComprobando')}</span>;
  }
  // No se pudo leer la lista: ni «Guardar» ni «Guardada». El aviso con «reintentar» va una sola vez
  // (AvisoGuardadas); aquí, nada que pulsar.
  if (guardada === undefined) return null;
  const alternar = async () => {
    if (accion === 'enviando') return;
    setAccion('enviando');
    const ok = guardada != null ? await quitar(guardada) : await guardar(sport, matchKey, snapshotId);
    setAccion(ok ? 'listo' : 'error');
  };
  return (
    <button type="button" onClick={() => void alternar()} aria-pressed={guardada != null} aria-busy={accion === 'enviando' || undefined} className={`${clase} ${accion === 'error' ? 'text-(--status-critical)' : guardada != null ? 'text-(--ink-strong)' : 'text-(--ink-muted)'}`}>
      {accion === 'error' ? t('seguimiento.error') : guardada != null ? t('partido.guardadaQuitar') : t('partido.guardar')}
    </button>
  );
}

/** El aviso de que no se pudo leer lo guardado, una vez por ficha, con «reintentar» (B3). */
function AvisoGuardadas() {
  const { t } = useI18n();
  const { estado, recargar } = useGuardadas();
  if (estado.fase !== 'error') return null;
  return (
    <p role="alert" className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[12px] text-(--status-critical)">
      <span>{t('partido.guardadasNoLeidas')}</span>
      <button type="button" onClick={recargar} className="toque underline underline-offset-2 [--toque-y:6px]">{t('partido.guardadaDesconocida')}</button>
    </p>
  );
}

/**
 * La ficha, con una clave por partido (D8): al pasar de un partido a otro sin salir de la ruta,
 * React reutilizaba el componente y la ficha nueva enseñaba un rato la deriva, el resultado y las
 * cuotas por casa de la anterior. Con la clave, cada partido empieza de cero.
 */
export default function Partido() {
  const { sport = '', id = '' } = useParams();
  return <FichaPartido key={`${sport}/${id}`} sport={sport} id={id} />;
}

/**
 * La ficha de un partido. La usa la página completa y el panel lateral de Partidos (D2), que le
 * pasa la clave del registro porque su URL es la de la lista.
 */
export function FichaPartido({ sport, id, claveDada }: { sport: string; id: string; claveDada?: string | null }) {
  const [q] = useSearchParams();
  const navigate = useNavigate();
  const { t, idioma } = useI18n();
  const f = formato(idioma);
  const deporte = (DEPORTES.includes(sport as DeporteId) ? sport : null) as DeporteId | null;
  const [item, setItem] = useState<Record<string, unknown> | null | 'error'>(null);
  const [pre, setPre] = useState<PrePartido | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const [casas, setCasas] = useState<PorCasa | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!deporte) return;
    let vivo = true;
    setItem(null);
    fetch(URL_PARTIDO[deporte](id))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Record<string, unknown>) => vivo && setItem(j))
      .catch(() => vivo && setItem('error'));
    fetch(`/api/odds/casas/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PorCasa | null) => vivo && setCasas(j))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [deporte, id]);

  const comun: PartidoComun | null = deporte && item && item !== 'error' ? aComun(deporte, item) : null;
  // Lo publicado manda en la cabecera (lo mismo que Destacados); si el modelo de hoy ya dice otra
  // cosa, se cuenta aquí en vez de cambiar el número en silencio.
  const publicada = item && item !== 'error' ? ((item.prediction as { publicada?: { en: string; actual: number[]; difiere: boolean } } | null)?.publicada ?? null) : null;
  const clave = comun?.prePartido?.matchKey ?? comun?.confianza?.matchKey ?? claveDada ?? q.get('clave');

  // Se espera a saber la hora del partido (G14): con ?clave= la petición salía antes de que llegara.
  const conResultado = item !== null && puedeTenerResultado(comun);
  useEffect(() => {
    if (!deporte || !clave) return;
    let vivo = true;
    fetch(`/api/prematch/${deporte}/${encodeURIComponent(clave)}`).then((r) => (r.ok ? r.json() : null)).then((j) => vivo && setPre(j)).catch(() => undefined);
    if (conResultado) fetch(`/api/resultado/${deporte}/${encodeURIComponent(clave)}`).then((r) => (r.ok ? r.json() : null)).then((j) => vivo && setRes(j)).catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [deporte, clave, conResultado]);

  if (!deporte) return <p className="text-[14px] text-(--ink-soft)">{t('partido.deporteDesconocido')}</p>;

  const abrirEquipo = (league: string, teamId: string) => navigate(rutaEquipo(deporte, league, teamId));
  const abrirJugador = (tour: string, pid: number) => navigate(rutaJugador(tour, pid));
  const nombre = comun ? nombrePartido(comun) : res ? nombrePartido({ sport: deporte, casa: res.casa, fuera: res.fuera }) : id;
  const copiar = async () => {
    // Siempre el enlace de la página completa, también desde el panel lateral.
    const url = new URL(rutaPartido(deporte, id), window.location.origin);
    if (clave) url.searchParams.set('clave', clave);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  // Deriva T-24h → final: la probabilidad del primer resultado en cada horizonte capturado.
  const deriva = (pre?.horizontes ?? []).filter((h) => h.fila).map((h) => ({ x: Date.parse(h.fila!.captured_at), y: h.fila!.probs[0] * 100, etiqueta: h.etiqueta }));
  const seleccionesCasas = [...new Set((casas?.series ?? []).map((s) => s.seleccion))];
  const sel = seleccion ?? seleccionesCasas[0] ?? null;
  const seriesCasas = (casas?.series ?? []).filter((s) => s.seleccion === sel && s.puntos.length > 0).map((s) => ({ nombre: s.casa, puntos: s.puntos.map((p) => ({ x: Date.parse(p.at), y: p.cuota })) }));

  const resumen = resumirHistorial(pre?.historial ?? []);
  const fecha = (iso: string) => f.fecha(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pctPp = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${f.numero(Math.abs(x), 1)} pp`;

  // El orden de la ficha (D, revisión del PR 17): quién juega → la estimación vigente con su hora →
  // sus límites → lo que usó el modelo → su historial → el mercado compatible → lo que haces tú.
  return (
    <article aria-labelledby="ficha-titulo">
      <p className="mb-1 text-[12px] text-(--ink-muted)">
        <Link to={RUTA_DE_PESTANA[deporte]} className="underline-offset-2 hover:underline">{t(`deporte.${deporte}`)}</Link> › {t('partido.titulo')}
      </p>
      <h2 id="ficha-titulo" tabIndex={-1} className="mb-3 min-w-0 break-words text-[20px] font-semibold text-(--ink-strong) outline-none">{nombre}</h2>

      {res?.resuelto && (
        <section aria-live="polite" className="mb-4 rounded-xl border p-4" style={{ borderColor: res.acerto == null ? 'var(--line-strong)' : res.acerto ? `${PROFIT_COLOR}66` : `${LOSS_COLOR}66` }}>
          <h3 className="text-[15px] font-semibold text-(--ink-strong)">{t('partido.acerto')}</h3>
          <p className="mt-1 text-[14px] text-(--ink-body)">
            {res.marcador && <span className="mr-2 font-semibold tabular-nums">{res.marcador}</span>}
            {/* Tres estados: sí, no, y sin veredicto (un empate con dos resultados, o nada que puntuar).
                Antes un null caía en «No». */}
            {res.acerto === true
              ? t('partido.si')
              : res.acerto === false
                ? t('partido.no')
                : res.evaluacion?.motivo
                  ? t('partido.sinVeredicto', { motivo: t(`partido.motivo.${res.evaluacion.motivo}`) })
                  : t('partido.empateSinVeredicto')}
            {res.acerto != null && res.probabilidadDada != null && ` ${t('partido.lePusoFrase', { p: f.porcentaje(res.probabilidadDada, 1) })}`}
          </p>
          {res.evaluacion?.tipo && res.evaluacion.capturadaEn && (
            <p className="mt-1 text-[12px] text-(--ink-muted)">
              {t(res.evaluacion.tipo === 'legado' ? 'partido.evaluadaLegado' : res.evaluacion.fuente === 'registro' ? 'partido.evaluadaFinalRegistro' : 'partido.evaluadaFinal', {
                cuando: fecha(res.evaluacion.capturadaEn),
              })}
            </p>
          )}
        </section>
      )}

      {item === null && <p className="text-[13px] text-(--ink-muted)">{t('comun.cargando')}</p>}
      {item === 'error' && !res && <p className="text-[14px] text-(--ink-soft)">{t('partido.noEncontrado')}</p>}
      {item === 'error' && res && <p className="mb-4 text-[13px] text-(--ink-muted)">{t('partido.yaNoProximo')}</p>}

      {/* 1. La estimación vigente, con su hora. La tarjeta enseña la publicación (lo que usan
          Destacados y el banco de papel); si después se registró otra, se dice cuál y cuándo. */}
      {item && item !== 'error' && (
        <section aria-labelledby="ficha-vigente" className="mb-4">
          <h3 id="ficha-vigente" className="mb-1 text-[15px] font-semibold text-(--ink-strong)">{t('partido.vigente')}</h3>
          <p className="mb-2 text-[12px] text-(--ink-muted)">
            {resumen
              ? t('partido.vigenteNota', { cuando: fecha(resumen.ultima.captured_at), version: resumen.ultima.model_version ?? t('partido.desconocido') })
              : publicada
                ? t('partido.vigentePublicada', { cuando: fecha(publicada.en) })
                : t('partido.vigenteSinRegistro')}
          </p>
          {publicada?.difiere && (
            <p className="mb-2 text-[13px] text-(--ink-soft)">
              {t('partido.publicada', { cuando: fecha(publicada.en), hoy: publicada.actual.map((p) => f.porcentaje(p, 1)).join(' · ') })}
            </p>
          )}
          {deporte === 'football' && <FootballCard item={item as never} onOpenTeam={abrirEquipo} />}
          {deporte === 'basketball' && <BasketballCard item={item as never} onOpenTeam={abrirEquipo} />}
          {deporte === 'baseball' && <BaseballCard item={item as never} onOpenTeam={abrirEquipo} />}
          {deporte === 'nfl' && <NflCard item={item as never} onOpenTeam={abrirEquipo} />}
          {deporte === 'nhl' && <NhlCard item={item as never} onOpenTeam={(id: string) => abrirEquipo('nhl', id)} />}
          {deporte === 'ufc' && <UfcCard item={item as never} onOpenFighter={(fid: string) => navigate(rutaLuchador(fid))} />}
          {deporte === 'tennis' && <TennisCard item={item as never} onOpenPlayer={abrirJugador} />}
        </section>
      )}

      {/* 2. Sus límites: lo que el número no es. */}
      {item && item !== 'error' && (
        <section aria-labelledby="ficha-limites" className="mb-4 rounded-xl border border-(--line) p-4">
          <h3 id="ficha-limites" className="mb-1 text-[15px] font-semibold text-(--ink-strong)">{t('partido.limites')}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-(--ink-soft)">
            <li>{t('partido.limiteProbabilidad')}</li>
            {comun?.demo && <li className="text-(--status-warning)">{t('partido.limiteDemo')}</li>}
            {!resumen && !comun?.demo && <li>{t('partido.limiteSinHistorial')}</li>}
          </ul>
        </section>
      )}

      {/* 3. Lo que usó el modelo (DET-2): las entradas guardadas con la última estimación, tal cual.
          Lo que no se sabía sale como DESCONOCIDO; no es una explicación causal. */}
      {pre?.entradas && pre.entradas.length > 0 && (
        <section className="mb-4 rounded-xl border border-(--line) p-4">
          <h3 className="mb-1 text-[15px] font-semibold text-(--ink-strong)">{t('partido.entradas')}</h3>
          <p className="mb-2 text-[12px] text-(--ink-muted)">{t('partido.entradasNota', { cuando: pre.entradasDe ? fecha(pre.entradasDe) : '—' })}</p>
          <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]">
            {pre.entradas.map((e) => (
              <div key={e.clave ?? e.etiqueta} className="contents">
                <dt className="text-(--ink-soft)">{escribir(t, idioma, e.explicacion, e.etiqueta)}</dt>
                <dd className={`tabular-nums ${e.valor == null ? 'text-(--status-warning)' : 'text-(--ink-strong)'}`}>
                  {e.valor == null ? t('partido.desconocido') : typeof e.valor === 'boolean' ? (e.valor ? t('comun.si') : t('comun.no')) : typeof e.valor === 'number' ? f.numero(e.valor, 1) : e.valor}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* 4. El historial (D1): original → última, Δ en pp, versiones y la evaluada. */}
      <section aria-labelledby="ficha-historial" className="mb-4 rounded-xl border border-(--line) p-4">
        <h3 id="ficha-historial" className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('partido.historial')}</h3>
        {resumen && resumen.filas.length > 1 && (
          <p className="mb-2 text-[13px] text-(--ink-body)">
            {t('partido.historialResumen', {
              desde: fecha(resumen.original.captured_at),
              hasta: fecha(resumen.ultima.captured_at),
              n: resumen.filas.length,
            })}{' '}
            {resumen.deltaPp && (
              <span className="tabular-nums">
                {resumen.ultima.outcomes.map((o, i) => `${o} ${pctPp(resumen.deltaPp![i])}`).join(' · ')}
              </span>
            )}
            {resumen.favoritoCambia && <span className="ml-1 text-(--status-warning)">{t('partido.historialFavoritoCambia')}</span>}
          </p>
        )}
        {resumen && resumen.versiones.length > 1 && (
          <p className="mb-2 text-[12px] text-(--ink-muted)">{t('partido.historialVersiones', { lista: resumen.versiones.map((v) => v ?? t('partido.desconocido')).join(' → ') })}</p>
        )}
        {deriva.length > 1 ? (
          <>
            <LineChart series={[{ nombre: (pre && nombreDelPrePartido(pre)) || '1', puntos: deriva }]} unidad=" %" formatoX={(x) => f.fecha(new Date(x).toISOString())} />
            <ul className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-(--ink-soft)">
              {deriva.map((d) => <li key={d.etiqueta}>{d.etiqueta}: <span className="tabular-nums text-(--ink-strong)">{f.numero(d.y, 1)} %</span></li>)}
            </ul>
          </>
        ) : (
          <p className="text-[13px] text-(--ink-muted)">{t(pre ? avisoSinDeriva(pre) : 'partido.sinInstantaneas', { n: pre?.instantaneas ?? 0 })}</p>
        )}
        {pre?.final && <p className="mt-1 text-[12px] text-(--ink-soft)">{t('partido.finalCongelada', { resultado: pre.outcomes?.[0] ?? resumen?.ultima.outcomes[0] ?? '—', p: f.porcentaje(pre.final.probs[0], 1) })}</p>}
        {resumen && (
          <div className="mt-3 border-t border-(--line) pt-3">
            {/* Si no se pudo leer lo guardado, se dice UNA vez aquí (no en cada fila). */}
            {clave && <AvisoGuardadas />}
            <ol className="space-y-1.5 text-[13px]">
              {resumen.filas.map((x, i) => (
                <li key={x.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular-nums text-(--ink-muted)">{fecha(x.captured_at)}</span>
                  <span className="tabular-nums text-(--ink-strong)">{x.outcomes.map((o, k) => `${o} ${f.porcentaje(x.probs[k], 1)}`).join(' · ')}</span>
                  {x.deltaPp && <span className="tabular-nums text-[12px] text-(--ink-muted)">({x.deltaPp.map(pctPp).join(' / ')})</span>}
                  <span className={`rounded px-1.5 text-[11px] ${x.papel === 'evaluada' ? 'text-(--ink-strong) ring-1 ring-(--accent)' : 'text-(--ink-muted) ring-1 ring-(--line-strong)'}`}>{t(`partido.papel.${x.papel}`)}</span>
                  {i === resumen.filas.length - 1 && x.papel !== 'evaluada' && resumen.filas.length > 1 && <span className="rounded px-1.5 text-[11px] text-(--ink-muted) ring-1 ring-(--line-strong)">{t('partido.papel.ultima')}</span>}
                  {x.model_version && <span className={`text-[11px] ${x.cambioDeVersion ? 'text-(--status-warning)' : 'text-(--ink-faint)'}`}>{x.cambioDeVersion ? t('partido.versionNueva', { v: x.model_version }) : x.model_version}</span>}
                  {clave && <GuardarEstimacion sport={deporte} matchKey={clave} snapshotId={x.id} />}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[12px] text-(--ink-muted)">{pre?.final ? t('partido.historialNotaCongelada') : t('partido.historialNota')}</p>
          </div>
        )}
      </section>

      {/* 5. El mercado, solo con cuotas reales de este mismo mercado (D3). Una demostración no tiene
          mercado con el que comparar. */}
      <section aria-labelledby="ficha-mercado" className="mb-4 rounded-xl border border-(--line) p-4">
        <h3 id="ficha-mercado" className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('partido.cuotasPorCasa')}</h3>
        {comun?.demo ? (
          <p className="text-[13px] text-(--ink-muted)">{t('partido.mercadoDemo')}</p>
        ) : seriesCasas.length === 0 ? (
          <p className="text-[13px] text-(--ink-muted)">{t('partido.sinCuotas')}</p>
        ) : (
          <>
            {seleccionesCasas.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={t('partido.seleccion')}>
                {seleccionesCasas.map((s) => (
                  <button key={s} aria-pressed={s === sel} onClick={() => setSeleccion(s)} className={`rounded-full px-2.5 py-0.5 text-[12px] ring-1 ${s === sel ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line)'}`}>{s}</button>
                ))}
              </div>
            )}
            <LineChart series={seriesCasas} formatoX={(x) => f.fecha(new Date(x).toISOString())} />
          </>
        )}
      </section>

      {/* 6. Lo que haces tú: seguir (avisos), guardar la estimación vigente (para comparar después) y
          compartir. Apuntar una apuesta va en Mis apuestas. */}
      <section aria-labelledby="ficha-acciones" className="mb-4 rounded-xl border border-(--line) p-4">
        <h3 id="ficha-acciones" className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('partido.acciones')}</h3>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {clave && (
            <span className="inline-flex items-center gap-1.5">
              <EstrellaSeguir kind="partido" sport={deporte} league={comun?.league ?? null} refId={clave} label={nombre} size={20} />
              <span className="text-(--ink-soft)">{t('partido.seguirNota')}</span>
            </span>
          )}
          {clave && resumen && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-(--ink-soft)">{t('partido.guardarVigente')}</span>
              <GuardarEstimacion sport={deporte} matchKey={clave} snapshotId={resumen.ultima.id} />
            </span>
          )}
          {/* E5: apuntar una apuesta enlazada a la estimación vigente (la instantánea), por el borrador
              de Mis apuestas. Solo con una estimación registrada y en un partido real. */}
          {comun && clave && resumen && !comun.demo && (
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(
                    CLAVE_BORRADOR,
                    JSON.stringify({ sport: deporte, league: comun?.league ?? null, event: nombre, market: 'moneyline', match_key: clave, snapshot_id: resumen.ultima.id, estimacion: { captured_at: resumen.ultima.captured_at, outcomes: resumen.ultima.outcomes, probs: resumen.ultima.probs, model_version: resumen.ultima.model_version } }),
                  );
                } catch {
                  // Sin almacenamiento: el formulario sale vacío y se apunta a mano.
                }
                navigate(`${RUTA_DE_PESTANA.bets}?borrador=1`);
              }}
              className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised)"
            >
              {t('partido.apuntarApuesta')}
            </button>
          )}
          <button onClick={() => void copiar()} className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised)">
            {copiado ? t('partido.copiado') : t('partido.copiarEnlace')}
          </button>
        </div>
      </section>
    </article>
  );
}
