// Importar el registro personal desde un CSV (Fase 5.16). Cada fila se valida como una apuesta
// normal; las que no pasan se devuelven con su línea y no se guarda nada de ellas.
import { useState } from 'react';

interface Resultado { importadas: number; rechazadas: { linea: number; error: string }[] }

export default function ImportarCsv({ onHecho }: { onHecho: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const importar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch('/api/bets/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: texto }) });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error ?? String(r.status));
      setRes(j as Resultado);
      if ((j as Resultado).importadas > 0) onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="rounded-lg px-3.5 py-2 text-[15px] text-(--ink-body) ring-1 ring-inset ring-(--line) transition hover:bg-(--raised)">
        Importar CSV
      </button>
    );
  }
  return (
    <section className="rounded-xl border border-(--line) bg-(--surface-card) p-4 text-[13px] text-(--ink-soft)">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-(--ink-strong)">Importar apuestas (CSV)</h3>
        <button onClick={() => setAbierto(false)} className="text-(--ink-muted) hover:text-(--ink-strong)">Cerrar</button>
      </div>
      <p className="mb-2">
        Cabecera con <code>sport, event, market, selection, odds, stake</code> y, si quieres, <code>placed_on</code> (AAAA-MM-DD), <code>league</code>, <code>status</code>, <code>payout</code>, <code>notes</code>, <code>tags</code> (separadas por |), <code>model_prob</code>. Separador coma o punto y coma.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Fichero CSV"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(setTexto);
        }}
        className="mb-2 block text-[13px]"
      />
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} aria-label="Contenido del CSV" placeholder="sport,event,market,selection,odds,stake" className="w-full rounded-lg border border-(--line) bg-transparent p-2 font-mono text-[12px] text-(--ink-body)" />
      <button onClick={() => void importar()} disabled={!texto.trim() || ocupado} className="mt-2 rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-50">
        {ocupado ? 'Importando…' : 'Importar'}
      </button>
      {error && <p role="alert" className="mt-2 text-[#e66767]">{error}</p>}
      {res && (
        <div role="status" aria-live="polite" className="mt-2">
          <p className="text-(--ink-body)">{res.importadas} importada(s){res.rechazadas.length ? `, ${res.rechazadas.length} rechazada(s)` : ''}.</p>
          {res.rechazadas.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {res.rechazadas.slice(0, 20).map((r) => (
                <li key={r.linea}>Línea {r.linea}: {r.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
