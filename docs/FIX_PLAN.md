# Claude Code prompt — "Análisis Bursátil": fix & polish plan (v2)

> Paste into Claude Code at the repo root, on branch `claude/stock-analysis-app-nt3ge9`.

---

## 0. How this job runs (read first)

This is a **multi-session job**. Do not try to finish it in one session.

**First session:**
1. Save this entire prompt verbatim as `docs/FIX_PLAN.md`.
2. Create `docs/PROGRESS.md`: a checklist with one line per item ID in this plan (0.1, 0.2 … 4.6), all unchecked.
3. Commit both files and run `git tag fase-0-inicio`.
4. Start Phase 0.

**Every later session:** I will just say *"Continue with docs/FIX_PLAN.md"*. Then:
1. Read `CLAUDE.md`, `docs/FIX_PLAN.md` and `docs/PROGRESS.md`.
2. Pick up the next unchecked item.

**After every commit**, update `docs/PROGRESS.md` with the item, its status, the commit hash and a one-line note.

**When your context is getting full:** finish the current item, update `PROGRESS.md`, and tell me to start a new session. Never leave an item half done without writing down exactly where you stopped.

---

## 1. Goal and quality bar

**Goal:** make the app correct, consistent and calm to use, **without changing what it decides**.

**Quality bar:**
- Every fix removes the **root cause**, not just the symptom I reported.
- Every fix also fixes **all other places with the same bug**.
- Every fix ships with a **test that failed before** the fix.
- Every fix leaves a **guard** (test, lint rule or type) so that kind of bug can't come back.
- Every UI fix is **checked visually**.

Fewer, deeper fixes beat many shallow patches. If a fix feels like a local hack, stop and look for the shared cause.

---

## 2. Context to read before touching code

- **`CLAUDE.md`**: project rules and conventions.
- **`REVISION_GENERAL.md`**: full review dated 8 Oct 2026. This plan uses its IDs:
  - visual bugs **V1–V18** (§9);
  - product and navigation issues (§10);
  - technical debt (§11);
  - priorities P1–P3 (§12);
  - manual checks (§13);
  - 25 screenshots in `revision/`.
- **`TODO.md`**: known data limitations.

The app is a FastAPI + SQLite backend with a React 19 + strict TypeScript + Tailwind 4 frontend. Price charts use lightweight-charts 5. The UI is in Spanish with es-ES number formatting.

**Baseline before any change:** run `pytest` (expect 1269 passing), `npx tsc --noEmit` and `npm run build`. If anything is red, stop and tell me.

---

## 3. Non-negotiable rules

If a change conflicts with any of these, the rule wins and you report the conflict.

**Data and decision rules (from `CLAUDE.md`):**
- **Absent ≠ zero.** Missing data shows as «—» and is counted separately. It is never filled with a neutral or favorable default.
- **UNKNOWN never becomes PASS.**
- **Fail-safe.** When in doubt, warn and shrink the position size; never enlarge it.
- **No price targets** anywhere in the app.
- Calculated content and AI-generated content stay visually separate (AI is violet and shows the model and a notice).
- Decision snapshots and expectations stay immutable. Do not touch their SHA-256 hashing, SQLite triggers or ORM events.
- `decision.py` decides **what** to do; `sizing.py` decides **how much**. Never mix them.

**Rules for this job:**
- **Do not change** thresholds, decision rules, sizing limits or confidence factors. This job is about correctness and clarity, not strategy.
- **Never delete or weaken an existing test** to make something pass. If an existing test conflicts with a fix, stop and report it.
- **The engine golden master (item 0.3) must stay identical.** If any golden output changes, stop, explain why, and wait for my OK.
- **Migrations:** Alembic only, numbered from 0009, and never destructive.
- **Language:** all UI text in Spanish; numbers, dates and currencies in es-ES.
- **Minimal diffs.** Don't reformat or refactor unrelated code inside a fix commit. Refactors belong to Phase 4 only.

---

## 4. Workflow for every item

1. **Reproduce.** Write a failing test, or take a screenshot that shows the bug.
2. **Find the root cause.** Find *why* it happens, not just *where*.
3. **Fix at the root.** Fix it in a shared helper, component or type, not with a local patch.
4. **Fix the siblings.** Search the whole codebase (backend and frontend) for the same pattern and fix every occurrence in the same commit.
5. **Prevent.** Add a guard so this kind of bug fails a test or lint check next time.
6. **Verify.**
   - Run all tests, `tsc` and the build.
   - For UI changes, take screenshots at **1440 px and 390 px**, look at them, and also check the empty and partial-data versions of the screen.
7. **Commit.** Message format: `fix(V3): …`, `feat(2.4): …`, `chore(0.2): …`. The commit body has three lines:
   - `Root cause: …`
   - `Siblings fixed: …`
   - `Guard: …`
8. **Update `docs/PROGRESS.md`.**

**Subagents and planning:**
- Use **Explore subagents** for broad sweeps, so your main context stays clean. Examples: every place a number is formatted, every hardcoded color, every user-facing text template.
- **At the end of each phase**, launch a **fresh reviewer subagent** that hasn't seen the work. Give it:
  - the phase diff (`git diff fase-N-inicio..HEAD`);
  - `CLAUDE.md`;
  - section 3 of this plan.

  Ask it for four lists: rule violations, missing or weak tests, unhandled empty or partial-data states, and places with the same bug that were missed. Fix what it finds before closing the phase.
- Close each phase with `git tag fase-N-hecha` and tag the next one `fase-N+1-inicio`.
- Use **plan mode** for Phase 3.

---

## Phase 0 — Safety net (before any fix)

**0.1 Frontend tests.** Add Vitest, @testing-library/react and jsdom, and add an `npm test` script.
*Done when:* `npm test` runs one example test.

**0.2 Continuous integration.** Add `.github/workflows/ci.yml`. On every push and PR it runs:
- backend: `pytest`, plus `ruff check` with a lenient config (don't mass-reformat the codebase);
- frontend: `npm ci`, `tsc --noEmit`, ESLint, `npm test` and `npm run build`;
- a separate, non-blocking job with `pip-audit` and `npm audit --audit-level=high` that only reports.

Use caching for pip and npm.

**0.3 Engine golden master. This is the most important item in Phase 0.** Before changing anything else:
1. Run the engine over all existing fixtures plus the edge-case pack from 0.4. That means `decide()`, sizing, confidence by evidence, opportunity cost, both DCFs, the earnings-quality rules and the thesis checks.
2. Save the outputs to `backend/tests/golden/*.json`:
   - verdicts, rule traces as **codes** and the `cambiaria` alternatives;
   - numbers rounded to 6 decimals;
   - **no** human-readable text, because the text will change in this job.
3. Add a test that compares current outputs against these files.

This is how we prove the fixes didn't change any decision.
*Done when:* the golden test passes on the untouched code and fails if you tweak any threshold by hand.

**0.4 Edge-case fixture pack** in `backend/tests/fixtures/extremos/`. It must include:
- an empty portfolio, and a portfolio with a single position;
- a company with every field missing, and one with partial debt data;
- a sector with fewer than 3 scorable companies;
- a NaN price and a negative price;
- a cache that only has stale data;
- a company that doesn't file with the SEC (a TSX ticker);
- a CAD position in a USD portfolio, and an inverted FX quote;
- a day with zero candidates, and a full 502-company day.

The golden master, the guard tests and the screenshot sweep all reuse this pack.

**0.5 Leak-guard tests.** These catch the bug family behind V3, V6 and V8.
- **Backend:** run every function that produces user-facing text over all fixtures, including the edge-case pack. That covers `reglas`, `cambiaria`, Qué cambió, Expectativas, Calidad de beneficios, Replay, the Cartera notes and the Hoy notes. The test fails if any text contains:
  - `undefined`, `NaN`, `None` or `null`;
  - a negative zero (`-0 %`, `-0,0`, a lone `-0`);
  - a snake_case token (`\b[a-z]+_[a-z0-9_]+\b`) or an UPPER_SNAKE token (`\b[A-Z]+_[A-Z_]+\b`);
  - an internal key such as `analisis:03:09:37` (`[a-z_]+:\d{2}:\d{2}`);
  - a parenthesized plural: `(es)` or `(s)`.

  Keep a short, explicit allowlist for legitimate cases.
- **Frontend:** render the key components with empty and partial props and apply the same checks to the visible text.

**0.6 Repeatable screenshots.**
- If the method that produced `revision/` isn't already a committed script, write one with Playwright, for example `frontend/scripts/capturas.ts`.
- It starts the demo server with fixture data and captures:
  - all 25 screens at 1440 px and 390 px;
  - edge-case variants: empty portfolio, zero-candidate day, a company with missing data, and AI content shown.
- Output goes to a folder passed as an argument. Use the existing `revision/` as the "before" set.
- *Done when:* one command regenerates every screenshot.

**0.7 Record and replay real provider responses.** Untested real data is the app's biggest risk, so this turns it into something testable.
- Add a `--grabar` (record) mode to `scripts/validar_con_datos_reales.py`. It saves sanitized responses (no keys, no account data) from each provider to `backend/tests/fixtures/reales/` for 3 tickers:
  - a large US company;
  - a company with significant debt;
  - a Canadian company.
- Add contract tests that replay those recordings through providers → validation → engine and check for no crashes, plausible ranges and correct units.
- In this environment there are probably no API keys. Build the mechanism, and make the tests **skip with a clear message** when no recordings exist. I will record locally.

**0.8 Database backup.** In `start.sh`, before `alembic upgrade head`:
- copy `app.db` to `backups/app-YYYYMMDD-HHMMSS.db`;
- keep the 10 most recent copies;
- add `backups/` to `.gitignore`.

**0.9 Security quick pass.** Report on each point and fix where needed:
- `.env` is in `.gitignore`, and a `.env.example` exists without keys.
- No key appears anywhere in the git history.
- uvicorn listens on `127.0.0.1`, not `0.0.0.0` (this is my portfolio data).
- CORS only allows the local Vite origin.
- **Tickers are validated at the API boundary** with a strict pattern (letters, digits, `.` and `-`, at most 12 characters). Anything else gets a 422 error, never a provider call or a file path.

---

## Phase 1 — Correctness and visual bugs (P1)

**1.1 Minimal semantic color tokens.** These come first because V1 and V9 are caused by the palette-inversion trick: the app was written in light colors and `index.css` redefines them. Don't migrate the whole app yet; just lay the foundation.

Define these CSS variables in `index.css`:

| Token | Value |
|---|---|
| `--surface-page` | `#080c18` |
| `--surface-card` | `#111a2e` |
| `--surface-sunken` | `#1b2540` |
| `--border` | `#26314f` |
| `--text-muted` | `#7c8aa8` |
| `--text` | `#b6c2da` |
| `--text-strong` | `#f4f7fd` |
| `--buy` | `#4ade9c` |
| `--sell` | `#f2555f` |
| `--warn` / `--warn-bg` | `#fcd34d` / `#2b1f06` |
| `--info` | `#38bdf8` |
| `--ai` / `--ai-bg` | a light violet on a very dark violet |

Also:
- Add a helper `leerToken(name)` that reads a token with `getComputedStyle(document.documentElement)`, for code that draws on canvas.
- Add a unit test that every text token has a contrast of at least **4.5:1** on every surface token.

New code uses tokens; existing classes stay as they are for now.

**1.2 V1, price chart colors.** `PriceChart.tsx` (lines ~49–89) hardcodes light-theme colors. Replace all of them with tokens:
- background transparent or `--surface-card`; text `--text-muted`;
- subtle grid lines (for example `--border` at low opacity); scale borders `--border`;
- volume bars in semi-transparent buy and sell colors (about 35 % opacity), **either in their own pane or on their own price scale with `scaleMargins: { top: 0.8, bottom: 0 }`**, so volume stays in the bottom fifth instead of a giant mint block.

Apply the same check to the RSI and MACD panels, the sparklines, the portfolio value curve and the correlation matrix.

*Guard:* an ESLint rule or test that fails if any `.tsx` file in `src/` contains a hardcoded light hex color (`#f1f5f9`, `#e2e8f0`, `#f8fafc`, `#a7f3d0`, `#fecaca` and the rest of the 50–200 scale).
*Done when:* screenshot 03 shows a dark grid, readable axes and volume confined to the bottom of the chart.

**1.3 V9, AI badges.** Replace `bg-violet-50` with `--ai-bg`. Sweep all of `src/` for any `-50` or `-100` background that isn't covered by the inversion, at least in NewsPage, QueCambioSection and ApiUsageBar. AI is off in the demo, so add a render test with AI content present.

**1.4 V3, «undefined %».** In «Cómo se repartió el tamaño» (`TodayPage.tsx:505`), when there are no candidates, show an empty state («Hoy no hay candidatas que dimensionar») instead of the breakdown.
Fix the root as well: if the field can be missing, mark it optional in `api/types.ts` so TypeScript forces every consumer to handle it.

**1.5 V11, contradiction in «Deuda y solidez».** The section says «Sin datos de endeudamiento» while also showing «Deuda neta 500 M». Find which field the section checks. The rule is:
- show «sin datos» only if **all** debt fields are missing;
- otherwise, show the fields that exist and name the ones that are missing, for example «Deuda neta disponible; falta deuda/EBITDA».

This must match how Ronda 2 handles partial debt. Test with a fixture that has net debt but no ratios.

**1.6 V18, fixed-window labels.** «Ingresos 5A: 10 %» appears with only 3 years of history. Labels must show the real window («Ingresos, crec. anual 3A») and be marked as partial when there are fewer years than the label's nominal window. Check every label with a fixed window (5A, 10A, TTM).

**1.7 V4, V5 and V8: one formatting system for numbers, money and dates.**

*Backend:* create `app/formato.py` with `fmt_num`, `fmt_pct`, `fmt_dinero`, `fmt_compacto` (M, mil M), `fmt_fecha` and `fmt_antiguedad` («hace 15 min»). Rules:
- es-ES decimal comma and dot thousands separator, **including 4-digit numbers** (6.000,00);
- a non-breaking space before «%»;
- negative zero is normalized to 0;
- `None` and `NaN` become «—»;
- **the currency code is always shown when a view mixes currencies** (USD and CAD);
- market event times show the exchange's time-zone label (ET).

Replace every f-string that formats a number in user-facing text. Search for `:.1f`, `:.2f`, `:.3f`, `:.0%` and `round(` inside strings.

*Frontend:* a single `src/lib/formato.ts` with the same functions, built on `Intl.NumberFormat('es-ES', { useGrouping: 'always' })`. By default es-ES skips grouping for 4-digit numbers, which is exactly bug V5. Include a manual fallback for browsers that don't support `'always'`. Replace every ad-hoc `toFixed` and `toLocaleString`.

*Where the frontend needs a figure that today arrives inside a backend sentence:* send the raw number and format it in the frontend.

*Tests:* one shared JSON table of cases used by **both** test suites: 0, −0, −0.0001, 6000, 20000, 1234567.891, NaN, null, negative percentages, USD and CAD amounts, and dates. Backend and frontend must produce exactly the same strings.

*Guards:*
- an ESLint `no-restricted-syntax` rule that bans `.toFixed(` and `.toLocaleString(` outside `formato.ts`;
- a pytest test that fails if a user-facing module outside `formato.py` formats numbers inside f-strings.

**1.8 V6, internal identifiers on screen, and a glossary.**

Create one label dictionary on each side: `app/etiquetas.py` and `src/lib/etiquetas.ts`. At minimum:

| Code | Label |
|---|---|
| `sin_datos` | sin datos |
| `sin_resolver` | sin resolver |
| `revenue` | ingresos |
| `eps_diluted` | BPA diluido |
| `gross_margin` | margen bruto |
| `correlacion` | correlación |
| `NO_ACCION` | No hacer nada |
| `COMPRAR_CON_EFECTIVO` | Comprar con efectivo |
| `REVISAR_PARA_FINANCIAR` | Revisar para financiar |
| `NO_TRADE` | No operar |
| `INDETERMINADO` | Indeterminado |

Also:
- Replay keys such as «analisis:03:09:37» become «Análisis de las 03:09».
- An unknown code is never shown raw: display it readably (underscores become spaces) and log a warning.
- *Guard:* iterate over **every enum and code the backend can emit** and assert each one has a label. The test must be exhaustive, not sampled.

Create `docs/GLOSARIO.md` with exactly one term per concept and enforce it across the UI. Examples:
- «BPA», never «EPS»;
- one word for portfolio (the Phase 3 merge settles whether it's «Cartera»);
- «puntuación», «stop», «tesis», «posición».

**1.9 V7, grammar, plurals and gender agreement.** Add a `plural(n, singular, plural)` helper on both sides, then fix:
- «que haya puntuación válido» → «válida»;
- «el umbral era cae por debajo de 0.180»: rewrite the template so it reads naturally («el umbral era: caer por debajo de 0,180»);
- «Ninguno de los 1 puntos» → «El único punto no se ha cruzado» / «Ninguno de los 3 puntos»;
- «posición(es)» → a real plural.

The leak-guard tests from 0.5 already catch `(es)` and `(s)`. Also review every text template for gender agreement.

**1.10 V13, stale messages.**
- In Hoy, replace «Revisa que FINNHUB_API_KEY…» with the real reason the list is empty. Scoring now uses EDGAR, not Finnhub.
- In the README, remove «sin Alembic por ahora».
- Sweep the code and docs for other statements that are no longer true, such as Finnhub-based scoring or the DCF assuming zero debt.

**1.11 Claude model ID (§11.5).**
- Move the model into configuration: `CLAUDE_MODEL` in `.env`, defaulting to `claude-sonnet-5-5` (enough for structured extraction, and cheaper). Allow `claude-opus-5-5` as an alternative.
- Remove the hardcoded `claude-opus-5`.
- On a model-not-found error from the API, the UI shows: «Modelo de Claude no válido: <id>. Revisa CLAUDE_MODEL en .env.»
- Document the variable in the README and in `.env.example`.

**1.12 FX plausibility bounds (§13).** In `validacion.py`, add a plausible range for each currency pair. For example, USD→CAD between 0.85 and 1.75 covers the last 30 years, and a value near 0.7 is almost certainly the pair quoted the wrong way round. Treat an out-of-range value as a provider failure, the same way NaN and negative values are treated today. Test with an inverted quote.

**1.13 Real-data validation script.**
- If keys and network access are available, run `scripts/validar_con_datos_reales.py`.
- Either way, improve the script so it:
  - writes a report `validacion_YYYYMMDD.md` listing each PASS, FAIL and UNKNOWN with the values compared and what to check by hand;
  - runs with a single command (`./start.sh validar`);
  - includes the manual checks from §13 as a checklist: EDGAR quarters against a real 10-Q, Finnhub consensus units, and FX direction.

**End of phase:** run the reviewer subagent, regenerate every screenshot into `revision/despues-fase1/`, and compare it with `revision/`.

---

## Phase 2 — Clarity and daily use (P2, no navigation changes)

**2.1 One consistent way to show data state.** Create one `<EstadoDato>` component for the four states (valid, stale, unknown, error), plus standard loading, empty and error-with-retry states.
- A stale value always shows its age and source, and it looks clearly different from a fresh one.
- Every data block in the app uses this component.
- *Done when:* the edge-case screenshot sweep shows no blank cards, no spinners stuck forever, and no stale data that looks fresh.

**2.2 V14, warning fatigue.** Create an `AvisoAgrupado` component: one amber box per card, with a one-line summary («3 avisos») and the details collapsible.
- Start with «Riesgo abierto» in Portafolio, then apply it to every card with more than one warning.
- Footnotes repeated on every card («no es una predicción») become a single «ⓘ» icon with a tooltip per card.
- No warning is removed; they are only grouped.

**2.3 Typography.**
- Minimum 12 px for content text; today there are 247 uses of 9, 10 and 11 px. Only uppercase micro-labels may stay at 11 px.
- All page titles use `text-lg`; three pages currently use `text-xl`.
- Card titles use a single color.
- Create `<TituloPagina>` and `<TituloTarjeta>` components so the styles can't drift again.

**2.4 V15, exposure bars.** One `<BarraExposicion>` component in one color (`--info`), used in both Cartera and Portafolio.

**2.5 V16, use of space.**
- The correlation matrix sizes to its content (cells of at least 32 px, with labels) and doesn't stretch to full width when there are few assets.
- Tables get sensible column widths, right-aligned numbers and `tabular-nums`.

**2.6 V10, company page tabs.** The 11 tabs wrap onto two rows at 1440 px.
- Keep 6 primary tabs: Resumen, Informe completo, Valoración, Salud y riesgo, Qué cambió, Decisiones y replay.
- Move the other 5 into a «Más ▾» menu: Fundamentales, Opciones, Filings, Resultados vs expectativas, Calidad de beneficios.

**2.7 V12, thesis status.** The same thesis shows as invalidated in one place and not crossed in another. Show both readings in both places with the same component: «Trimestral: invalidada · Anual: no cruzado». Add a tooltip that explains why they can differ.

**2.8 V17, TradingView logo.** lightweight-charts is Apache-2.0 with a NOTICE file that requires attribution. Read the NOTICE, then do one of two things:
- keep the logo; or
- set `layout.attributionLogo: false` and add a visible link «Gráficos: TradingView Lightweight Charts».

**2.9 Summary mode (§10.7).** Add a global toggle «Modo resumen».
- When on, explanatory paragraphs collapse into «¿Por qué?» disclosures.
- When off, everything looks exactly as it does today.
- Store the setting in localStorage, wrapped in try/catch.

**2.10 Missing basic actions (§10.5).**
- **Edit a thesis:** a PUT endpoint and a form. Each edit saves a new row in `tesis_revisiones` (migration 0009) instead of overwriting. Editing never changes past decision snapshots.
- **Multiple watchlists:** a non-destructive migration that moves the current entries into a list called «Principal».
- **CSV export** for positions, closed trades, theses and watchlists:
  - standard format: comma separator, dot decimals, ISO dates, UTF-8 with BOM so accents survive;
  - raw numbers, not es-ES formatted, so the files re-import cleanly into Excel or Google Sheets.

**2.11 Global "what changed in my positions" view (§10.6).** A card at the top of Hoy (or its own page) listing the material changes for each open position since the previous analysis. Reuse the existing Qué cambió logic; add no new rules.

**2.12 V2, mobile layout.**
- Below 768 px the sidebar collapses into a hamburger menu.
- Tables sit inside horizontally scrollable containers.
- KPIs show in two columns and the chart uses the full width.
- *Done when:* the 390 px screenshots of every screen have no horizontal page scroll and no word-by-word text wrapping.

**2.13 Accessibility.**
- Run axe-core through the screenshot script on every screen and fix all serious and critical findings.
- Every interactive element has a visible focus ring.
- Every icon-only button has an `aria-label`.
- Green and red values always also carry a sign, an icon or a word, so meaning never depends on color alone.

**2.14 Performance, measured first.**
- Measure the first render and scroll of Hoy with the 502-company fixture.
- If the first render is above ~300 ms or scrolling stutters, virtualize the list (for example with `@tanstack/react-virtual`) and draw the sparklines as lightweight SVG instead of full chart instances.
- Report the numbers before and after. Don't optimize anything you haven't measured.

**End of phase:** run the reviewer subagent, regenerate all screenshots into `revision/despues-fase2/`, and compare.

---

## Phase 3 — Structure (use plan mode; write the plan and STOP)

Write `docs/PLAN_NAVEGACION.md` covering:
- the new routes and what moves where;
- redirects from the old routes;
- the API endpoints affected;
- the impact on tests and on the golden master.

**Don't change any route until I approve the plan.**

**3.1 Merge Portafolio and Cartera** into one section, «Cartera», with sub-tabs Posiciones · Riesgo · Oportunidad. Remove the duplicates: sector exposure and concentration each appear twice today, keep one of each.

**3.2 Merge Tesis and Vigilancia** into «Tesis», with sub-tabs Mis tesis · Vigilancia · Diario.

**3.3 A single DCF.** Today the company page and the Valoración module use two different DCF endpoints with different assumptions.
- The engine that stays is the Valoración module's (`/api/valuation/{s}`).
- The Valoración tab on the company page shows a compact summary from that same endpoint, plus a button «Abrir análisis completo».
- Before retiring `/api/stocks/{s}/valuation/dcf`:
  - compare the assumptions of the two implementations;
  - port anything the module lacks, especially Ronda 2's partial-debt handling (unknown debt must never become zero again);
  - keep the old endpoint as a thin, deprecated alias for one release.
- *Test:* the same fixtures produce the same ranges in both views. The golden master must still match.

**3.4 Ranking hierarchy (§10.3).** Hoy is the only action list.
- In the sidebar, rename «Herramientas» to «Investigar».
- Screener, Multifactor and Señales each get a subtitle («explora; no decide») and a note «La decisión de compra sale de Hoy».
- No scoring logic changes.

---

## Phase 4 — Code health (P3)

**4.1 Full token migration.**
- Replace the palette inversion with semantic tokens in every component, one page at a time, with screenshots before and after each page.
- At the end, delete the color redefinitions from `index.css`.
- *Optional, and only once the dark theme looks the same as before:* a light mode driven by `prefers-color-scheme`, with a manual toggle.

**4.2 Split large files with no behavior change.** Tests and the golden master must pass untouched.
- `TodayPage.tsx` (1217 lines) becomes separate components (counts, selector and filters, row, size breakdown, «Lo que NO comprar») plus a `useListaDiaria` hook.
- The `signals.py` router is split by sub-domain: backtest, baselines, experiments and holdout.
- Afterwards, split `PortfolioPage.tsx` and `SignalsPage.tsx` if they're still above ~600 lines.

**4.3 Split the README** into:
- a short `README.md` (what the app is, install, `./start.sh`, API keys, daily use; at most 150 lines);
- `docs/ARQUITECTURA.md`;
- `docs/HISTORIAL.md` (bug history, the RC1 audit, Ronda 2).

**4.4 Font.** Self-host Inter with `@fontsource/inter` (no Google Fonts, so the app works offline) and apply `font-variant-numeric: tabular-nums` to figures.

**4.5 Tighten linting.** Raise the ruff and ESLint rules one step and fix what they find. Add mypy with a baseline file so only new errors fail.

**4.6 Update `CLAUDE.md` with the new conventions**, so future sessions don't reintroduce these bugs:
- tokens instead of raw colors;
- `formato.*` for every number, date and amount;
- `etiquetas.*` for every code shown to the user;
- `plural()`;
- `<EstadoDato>` and `AvisoAgrupado`;
- the glossary;
- the golden master;
- the screenshot command.

---

## Final report

Keep `docs/INFORME_CORRECCIONES.md` up to date at the end of every phase. It holds a table with one row per ID (V1–V18, the items from §10 and §11, and items 0.1–4.6 of this plan) and these columns:
- status: done / partial / not done / needs Victor;
- root cause, in one line;
- commit hash;
- test or guard added;
- before and after screenshots.

Below the table, add three sections:
- **What couldn't be verified here**, especially anything that needs real API keys.
- **What changed in behavior**, which should be nothing, backed by the golden master.
- **Risks or doubts** for me to review.

## Out of scope

- No changes to thresholds, rules, sizing limits or confidence factors.
- No features beyond the ones in this plan.
- Don't try to fix the TODO.md limitations that need new data sources (survivorship bias, ETF holdings, beta against SPY, the fixed tax rate in ROIC). Keep them documented.
- Don't remove any legal or data-honesty notices. Group them instead.
