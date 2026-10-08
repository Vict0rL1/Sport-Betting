// Typed client for the Tennis Predictor REST API. Types mirror the server's
// response shapes (server/src/types.ts + model/predict.ts).
export type * from './apiTipos';
import type { Tour, Profile, UpcomingWithPrediction, TournamentsResponse, Meta, RefreshResult, TrackRecord, EloRankingResponse } from './apiTipos';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>('/meta'),
  tours: () => get<Tour[]>('/tours'),
  tournaments: (tour?: string) =>
    get<TournamentsResponse>(`/tournaments${tour ? `?tour=${encodeURIComponent(tour)}` : ''}`),
  upcoming: (tour?: string, tournament?: string) => {
    const q = new URLSearchParams();
    if (tour) q.set('tour', tour);
    if (tournament) q.set('tournament', tournament);
    return get<UpcomingWithPrediction[]>(`/matches/upcoming?${q.toString()}`);
  },
  prediction: (id: string) => get<UpcomingWithPrediction>(`/predictions/${encodeURIComponent(id)}`),
  profile: (tour: string, id: number) => get<Profile>(`/players/${tour}/${id}`),
  trackRecord: (tour?: string) =>
    get<TrackRecord>(`/track-record${tour ? `?tour=${encodeURIComponent(tour)}` : ''}`),
  refresh: () => post<RefreshResult>('/refresh'),
  power: (tour: string, opts: { limit?: number; minMatches?: number; activeDays?: number } = {}) => {
    const q = new URLSearchParams({ tour });
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.minMatches != null) q.set('minMatches', String(opts.minMatches));
    // 0 significa «sin filtro de actividad»; el servidor lo interpreta así a propósito.
    if (opts.activeDays != null) q.set('activeDays', String(opts.activeDays));
    return get<EloRankingResponse>(`/power?${q.toString()}`);
  },
};
