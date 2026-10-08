// Página de jugador (Fase 5.12, tenis): Elo general y por superficie, ranking, últimos
// partidos y los próximos con su probabilidad. URL compartible.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Profile, type UpcomingWithPrediction } from '../lib/api';
import { Flag } from '../components/ui';
import { EstrellaSeguir } from '../components/seguimiento';
import { rutaPartido } from '../rutas';
import { useI18n, formato } from '../i18n';

export default function Jugador() {
  const { tour = 'atp', id = '0' } = useParams();
  const { t, idioma } = useI18n();
  const f = formato(idioma);
  const [p, setP] = useState<Profile | null | 'error'>(null);
  const [proximos, setProximos] = useState<UpcomingWithPrediction[]>([]);
  useEffect(() => {
    let vivo = true;
    setP(null);
    api.profile(tour, Number(id)).then((j) => vivo && setP(j)).catch(() => vivo && setP('error'));
    api
      .upcoming(tour)
      .then((rows) => vivo && setProximos(rows.filter((r) => String(r.match.p1_id) === id || String(r.match.p2_id) === id)))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [tour, id]);
  return (
    <div>
      <p className="mb-1 text-[12px] text-(--ink-muted)">{tour.toUpperCase()} › {t('jugador.titulo')}</p>
      {p === 'error' && <p className="text-[14px] text-(--ink-soft)">{t('jugador.noExiste')}</p>}
      {p === null && <p className="text-[13px] text-(--ink-muted)">{t('comun.cargando')}</p>}
      {p && p !== 'error' && (
        <>
          <div className="mb-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex flex-wrap items-center gap-2 text-[20px] font-semibold text-(--ink-strong)">
                <Flag country={p.country} height={14} />
                <span className="break-words">{p.name}</span>
              </h2>
              <p className="text-[13px] text-(--ink-soft)">
                {p.ranking && <>{t('jugador.oficial', { rango: p.ranking.rank })} · </>}
                {t('jugador.resumen', { rango: p.eloRank, partidos: p.rating.matches_played })}
                {p.age != null && ` · ${t('jugador.edad', { edad: p.age })}`}
              </p>
            </div>
            <EstrellaSeguir kind="jugador" sport="tennis" league={tour} refId={id} label={p.name} size={22} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-(--line) p-4">
              <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">Elo</h3>
              <dl className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
                {([[t('jugador.general'), p.rating.overall], [t('jugador.dura'), p.rating.hard], [t('jugador.arcilla'), p.rating.clay], [t('jugador.hierba'), p.rating.grass]] as [string, number][]).map(([k, v]) => (
                  <div key={k}><dt className="text-(--ink-muted)">{k}</dt><dd className="tabular-nums text-(--ink-strong)">{Math.round(v)}</dd></div>
                ))}
              </dl>
            </section>
            <section className="rounded-xl border border-(--line) p-4">
              <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('jugador.saque', { n: p.serve.matches })}</h3>
              <dl className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-3">
                {([[t('jugador.aces'), p.serve.acePct], [t('jugador.dobles'), p.serve.dfPct], [t('jugador.primerSaque'), p.serve.firstInPct], [t('jugador.ganados1'), p.serve.firstWonPct], [t('jugador.ganados2'), p.serve.secondWonPct], [t('jugador.bpSalvados'), p.serve.bpSavedPct]] as [string, number | null][]).map(([k, v]) => (
                  <div key={k}><dt className="text-(--ink-muted)">{k}</dt><dd className="tabular-nums text-(--ink-strong)">{v == null ? '—' : f.porcentaje(v > 1 ? v / 100 : v, 1)}</dd></div>
                ))}
              </dl>
            </section>
            <section className="rounded-xl border border-(--line) p-4">
              <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('jugador.ultimos')}</h3>
              {p.recent.length === 0 ? <p className="text-[13px] text-(--ink-muted)">{t('jugador.sinRecientes')}</p> : (
                <ul className="space-y-1 text-[13px]">
                  {p.recent.slice(0, 10).map((m, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0 break-words text-(--ink-body)">{t(m.won ? 'jugador.gano' : 'jugador.perdio', { rival: m.opponent_name ?? String(m.opponent_id) })}</span>
                      <span className="text-(--ink-muted)">{m.date}{m.tourney_name ? ` · ${m.tourney_name}` : ''}{m.score ? ` · ${m.score}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-(--line) p-4 lg:col-span-2">
              <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('equipo.proximos')}</h3>
              {proximos.length === 0 ? <p className="text-[13px] text-(--ink-muted)">{t('equipo.sinProximos')}</p> : (
                <ul className="space-y-1 text-[13px]">
                  {proximos.map((r) => {
                    const soyP1 = String(r.match.p1_id) === id;
                    const prob = r.prediction ? (soyP1 ? r.prediction.model.prob1 : 1 - r.prediction.model.prob1) : null;
                    return (
                      <li key={r.match.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <Link to={rutaPartido('tennis', r.match.id)} className="min-w-0 break-words text-(--ink-body) underline-offset-2 hover:underline">
                          {r.match.p1_name} vs {r.match.p2_name} · {r.match.tournament_name}
                        </Link>
                        <span className="text-(--ink-muted)">
                          {f.fecha(r.match.commence_time)}
                          {prob != null && <span className="ml-2 tabular-nums text-(--ink-strong)">{f.porcentaje(prob)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
