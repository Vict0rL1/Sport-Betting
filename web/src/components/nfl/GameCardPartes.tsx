// Piezas de GameCard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { type NflPrediction, type NflSpreadQuote } from '../../lib/nfl';
import { AWAY_COLOR, HOME_COLOR, NEUTRAL_COLOR, pct } from '../../lib/theme';
import { PostprocessPanel } from '../PostprocessPanel';
import { BarRow, CompareRow, FactorValue, FormDots, Panel, SectionTitle, TeamCrest } from '../ui';
import { ClimaPanel } from '../ClimaPanel';

export const twoWay = (m: { home: number; away: number }): { home: number; away: number } => ({
  home: m.home / (m.home + m.away),
  away: m.away / (m.home + m.away),
});

export const fmtLine = (l: number) => (l === 0 ? 'PK' : `${l > 0 ? '+' : ''}${l}`);

/**
 * The key numbers.
 *
 * The single most useful thing this model knows and a normal curve does not.
 * Rendered as plain figures rather than a chart because four numbers are four
 * numbers, and the point is the comparison between them.
 */
export function KeyNumbers({ prediction }: { prediction: NflPrediction }) {
  const three = prediction.keyNumbers.find((k) => k.margin === 3)?.probability ?? 0;
  const seven = prediction.keyNumbers.find((k) => k.margin === 7)?.probability ?? 0;
  return (
    <div className="mt-3 border-b border-(--line) pb-3">
      <SectionTitle right={`3 o 7: ${pct(three + seven)}`}>
        El margen cae justo en…
      </SectionTitle>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {prediction.keyNumbers.map((k) => (
          <div key={k.margin} className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">
              {k.margin} puntos
            </div>
            <div className="text-[16px] font-semibold tabular-nums text-(--ink-strong)">
              {pct(k.probability)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-(--ink-muted)">
        En la NFL el marcador se mueve de 3 en 3 y de 7 en 7, así que el margen final se amontona en
        esos números. Por eso una línea de −3 y una de −3.5 no son la misma apuesta.
      </p>
    </div>
  );
}

export function TeamName({
  league, id, name, elo, eloRank, record, alignRight = false, homeBadge = false, onClick,
}: {
  league: string;
  id: string | null;
  name: string;
  elo: number | null;
  eloRank: number | null;
  record: { wins: number; losses: number; ties: number } | null;
  alignRight?: boolean;
  homeBadge?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`min-w-0 flex-1 ${alignRight ? 'text-right' : ''}`}>
      <span className={`flex min-w-0 items-center gap-1.5 ${alignRight ? 'justify-end' : ''}`}>
        {/* The crest, not the series dot: the dot's job is done one line below
            by the hero label, and two identity marks on one line is one too many. */}
        {!alignRight && <TeamCrest league={league} name={name} code={id} />}
        <button
          onClick={onClick}
          disabled={!onClick}
          // Wraps rather than truncates. At the larger type size "New England
          // Patriots" no longer fits half a 390px card, and `truncate` turned the
          // two team names — the one thing a matchup card exists to tell you —
          // into "New Engl…" and "Seattle S…". Two short lines cost a few pixels
          // of height and lose nothing.
          className={`max-w-full text-left text-[17px] font-semibold leading-tight break-words text-(--ink-strong) ${
            alignRight ? 'text-right' : ''
          } ${onClick ? 'hover:underline' : 'cursor-default'}`}
          title={onClick ? 'Ver ficha del equipo' : name}
        >
          {name}
        </button>
        {alignRight && <TeamCrest league={league} name={name} code={id} />}
      </span>
      <div className="text-[13px] text-(--ink-muted)">
        {homeBadge && 'local · '}
        {elo != null && (
          <>
            Elo {Math.round(elo)}
            {eloRank != null && ` (#${eloRank})`}
          </>
        )}
        {record && ` · ${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`}
      </div>
    </div>
  );
}

export function Detail({ prediction, clima }: { prediction: NflPrediction; clima?: import('../../lib/clima').ClimaFicha | null }) {
  const { teams, spread, total, bands, scorelines, h2h, market, reasoning, summary, context } =
    prediction;
  const home = teams.home;
  const away = teams.away;
  const formColors = { W: HOME_COLOR, D: NEUTRAL_COLOR, L: AWAY_COLOR };
  const maxBand = Math.max(...bands.map((b) => b.probability));
  const maxScore = Math.max(...scorelines.map((s) => s.probability));

  return (
    <div className="space-y-3">
      <Panel>
        <SectionTitle>Por qué</SectionTitle>
        <p className="mb-2 text-[15px] leading-relaxed text-(--ink-body)">{reasoning.text}</p>
        <dl className="space-y-1 text-[13px]">
          {reasoning.factors.map((f) => (
            <div key={f.key} className="flex justify-between gap-3">
              <dt className="text-(--ink-soft)">{f.label}</dt>
              <dd>
                <FactorValue
                  color={f.pointsForHome >= 0 ? HOME_COLOR : AWAY_COLOR}
                  neutral={f.pointsForHome === 0}
                >
                  {f.pointsForHome === 0
                    ? '0 (neutral)'
                    : `${Math.abs(f.pointsForHome)} pts para ${f.pointsForHome > 0 ? home.name : away.name}`}
                </FactorValue>
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      {/* WHO IS PLAYING QUARTERBACK.
          Its own panel because it is the only model input a reader can check and
          correct from the news, and because the assumption behind it needs saying
          out loud: the schedule never names a starter, so the model uses whoever
          started last. Stating that is the difference between a reader who knows
          the forecast is stale and one who only suspects it. */}
      {(prediction.quarterbacks.home || prediction.quarterbacks.away) && (
        <Panel>
          <SectionTitle right="quien jugó el último partido">Quarterback titular</SectionTitle>
          <dl className="space-y-1 text-[13px]">
            {([
              ['home', home.name, prediction.quarterbacks.home, HOME_COLOR],
              ['away', away.name, prediction.quarterbacks.away, AWAY_COLOR],
            ] as const).map(([key, teamName, qb, color]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-(--ink-soft)">
                  {qb?.name ?? 'sin dato'}{' '}
                  <span className="text-(--ink-faint)">· {teamName}</span>
                </dt>
                <dd>
                  <FactorValue color={color} neutral={!qb || qb.points === 0}>
                    {!qb
                      ? '—'
                      : qb.points === 0
                        ? 'nivel medio de la liga'
                        : `${qb.points > 0 ? '+' : ''}${qb.points} pts · ${qb.starts} titularidades`}
                  </FactorValue>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[13px] leading-relaxed text-(--ink-muted)">
            Medido sobre 27 temporadas: el 52% de los equipos usa más de un titular por temporada, así
            que quién juega de quarterback mueve el pronóstico. Si sabes que hay un cambio esta semana,
            el modelo aún no lo sabe.
          </p>
        </Panel>
      )}

      {/* El clima (Fase 2C): información, no entrada del modelo. */}
      <ClimaPanel clima={clima} />

      {/* The handicap at the two lines the whole market is built around, priced
          at any line the reader might be looking at. */}
      <Panel>
        <SectionTitle right={spread.fromMarket ? 'línea del mercado' : 'línea del modelo'}>
          El hándicap, línea por línea
        </SectionTitle>
        <div className="space-y-1 text-[13px]">
          {spread.keyLines.map((q) => (
            <SpreadLine key={q.line} quote={q} homeName={home.name} />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-(--ink-muted)">
          «Nulo» es la probabilidad de que el margen caiga justo en la línea y te devuelvan la
          apuesta. En una línea entera de 3 puntos eso pasa una de cada trece veces.
        </p>
      </Panel>

      <Panel>
        <SectionTitle right={`${total.expected} esperados`}>Total de puntos</SectionTitle>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="w-16 shrink-0 text-(--ink-soft)">Over {total.line}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-(--raised)">
            <div
              className="h-full rounded-full"
              style={{ width: `${total.over * 100}%`, backgroundColor: HOME_COLOR }}
            />
          </div>
          <span className="w-24 shrink-0 text-right tabular-nums text-(--ink-soft)">
            {pct(total.over)} / {pct(total.under)}
          </span>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Por cuánto gana</SectionTitle>
        <div className="space-y-1">
          {bands.map((b) => (
            <BarRow
              key={b.label}
              label={b.label.replace('local por ', '+').replace('visitante por ', '−')}
              value={b.probability}
              max={maxBand}
              color={
                b.from === 0 && b.to === 0
                  ? NEUTRAL_COLOR
                  : (b.from ?? -1) > 0
                    ? HOME_COLOR
                    : AWAY_COLOR
              }
              valueLabel={pct(b.probability)}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-(--ink-muted)">
          Los tramos son de una, dos y tres anotaciones: «dentro de una anotación» es la frase con la
          que se sigue el último cuarto.
        </p>
      </Panel>

      <Panel>
        <SectionTitle>Marcadores más probables</SectionTitle>
        <div className="space-y-1">
          {scorelines.map((s) => (
            <BarRow
              key={s.label}
              label={s.label}
              value={s.probability}
              max={maxScore}
              color={s.home > s.away ? HOME_COLOR : s.home === s.away ? NEUTRAL_COLOR : AWAY_COLOR}
              valueLabel={pct(s.probability)}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-(--ink-muted)">
          Salen de combinar el margen y el total, así que cuadran exactamente con los dos paneles de
          arriba. A cambio, no saben que 22 puntos es un marcador raro y 24 uno corriente.
        </p>
      </Panel>

      <Panel>
        <SectionTitle>Los dos equipos</SectionTitle>
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[13px]">
          <div />
          <div className="flex w-20 items-center justify-end gap-1.5 font-medium text-(--ink-strong)">
            <span className="break-words">{away.name}</span>
            <TeamCrest league={prediction.league} name={away.name} code={away.id} size={14} />
          </div>
          <div className="flex w-20 items-center justify-end gap-1.5 font-medium text-(--ink-strong)">
            <span className="break-words">{home.name}</span>
            <TeamCrest league={prediction.league} name={home.name} code={home.id} size={14} />
          </div>
          <CompareRow label="Elo" left={Math.round(away.elo)} right={Math.round(home.elo)} />
          <CompareRow label="Puntos a favor / partido" left={away.pf ?? '—'} right={home.pf ?? '—'} />
          <CompareRow label="Puntos en contra / partido" left={away.pa ?? '—'} right={home.pa ?? '—'} />
          <CompareRow
            label="Balance"
            left={`${away.record.wins}-${away.record.losses}${away.record.ties ? `-${away.record.ties}` : ''}`}
            right={`${home.record.wins}-${home.record.losses}${home.record.ties ? `-${home.record.ties}` : ''}`}
          />
          <CompareRow
            label="Pitagórico"
            title="Victorias que sugieren los puntos anotados y encajados (exponente 2.37, el de la NFL)"
            left={away.pythagorean != null ? pct(away.pythagorean) : '—'}
            right={home.pythagorean != null ? pct(home.pythagorean) : '—'}
          />
          <CompareRow
            label="Últimos 5"
            title="Azul = ganado · gris = empatado · naranja = perdido"
            left={<FormDots results={away.last5} colors={formColors} />}
            right={<FormDots results={home.last5} colors={formColors} />}
          />
        </dl>
      </Panel>

      <Panel>
        <SectionTitle right={`${h2h.awayWins} · ${h2h.homeWins} (${h2h.total})`}>
          Historial directo
        </SectionTitle>
        {h2h.recent.length === 0 ? (
          <p className="text-[13px] text-(--ink-muted)">Sin enfrentamientos previos en el archivo.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {h2h.recent.map((m, i) => (
              <li key={i} className="flex justify-between gap-3 text-(--ink-body)">
                <span className="shrink-0 text-(--ink-muted)">
                  {m.season} · sem {m.week}
                </span>
                <span className="break-words text-right">
                  {m.awayId === away.id ? away.name : home.name} {m.awayPoints}–{m.homePoints}{' '}
                  {m.homeId === home.id ? home.name : away.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle>De dónde sale este número</SectionTitle>
        <PostprocessPanel
          postprocess={prediction.postprocess}
          rows={[
            { label: 'Local', raw: twoWay(prediction.model).home, final: prediction.final.home },
            { label: 'Visitante', raw: twoWay(prediction.model).away, final: prediction.final.away },
          ]}
        />
      </Panel>

      {market.market && (
        <Panel>
          <SectionTitle
            right={
              market.market.overround != null
                ? `margen ${((market.market.overround - 1) * 100).toFixed(1)}%`
                : 'de la línea de cierre'
            }
          >
            Mercado
          </SectionTitle>
          {market.market.odds ? (
            <p className="text-[13px] leading-relaxed text-(--ink-body)">
              Cuotas {market.market.odds.away} / {market.market.odds.home} · implícitas sin vig{' '}
              {pct(market.market.away)} / {pct(market.market.home)}
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-(--ink-body)">
                Línea de cierre {market.market.line! > 0 ? '+' : ''}
                {market.market.line} → {pct(market.market.away)} / {pct(market.market.home)}
              </p>
              {/* Said on the card and not only in the docs, because it changes how the
                  number above it should be read: on this sport the market is the better
                  forecast, and the reader is entitled to know that before comparing. */}
              <p className="mt-1.5 text-[12px] leading-relaxed text-(--ink-soft)">
                Medido sobre 7.276 partidos, esta cifra acierta más que la del modelo
                (Brier 0.2115 frente a 0.2180). Cuando discrepan, lo más probable es que
                tenga razón el mercado.
              </p>
            </>
          )}
        </Panel>
      )}

      <Panel>
        <SectionTitle right={`${context.homeAdvantagePoints} pts de ventaja de campo`}>
          Lectura completa
        </SectionTitle>
        <ul className="space-y-1.5">
          {summary.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-(--ink-soft)">
              <span aria-hidden className="text-(--ink-faint)">
                •
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function SpreadLine({ quote, homeName }: { quote: NflSpreadQuote; homeName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 tabular-nums text-(--ink-body)" title={quote.label}>
        {homeName.split(' ').slice(-1)[0]} {fmtLine(quote.line)}
      </span>
      <div className="flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full">
        <div
          className="rounded-l-full"
          style={{ width: `${quote.cover * 100}%`, backgroundColor: HOME_COLOR }}
        />
        {quote.push > 0.002 && (
          <div style={{ width: `${quote.push * 100}%`, backgroundColor: NEUTRAL_COLOR }} />
        )}
        <div
          className="rounded-r-full"
          style={{ width: `${quote.fail * 100}%`, backgroundColor: AWAY_COLOR }}
        />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-(--ink-soft)">
        {pct(quote.cover)}
        {quote.push > 0.002 && <span className="text-(--ink-muted)"> · {pct(quote.push)} nulo</span>}
      </span>
    </div>
  );
}
