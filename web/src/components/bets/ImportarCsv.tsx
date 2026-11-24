// Importar el registro personal desde un CSV (Fase 5.16). Cada fila se valida como una apuesta
// normal; las que no pasan se devuelven con su línea y no se guarda nada de ellas. Antes de escribir,
// una vista previa dice qué entra, qué no y qué se pierde (fase F del seguimiento del PR #18).
import { useState } from 'react';
import { conNodos, existeClave, useI18n, type Clave } from '../../i18n';
import { STATUS } from '../../lib/theme';

interface ErrorDeFila { campo: string; codigo: string; params?: Record<string, string | number>; mensaje: string }
interface Resultado { importadas: number; rechazadas: { linea: number; error: string; errores?: ErrorDeFila[] }[]; avisos?: { linea: number; codigo: string }[]; omitidas?: number }
/** La vista previa (POST /api/bets/import/preview): nada se ha escrito todavía. */
interface Vista {
  error: ErrorDeFila | null;
  ignoradas: string[];
  filas: { linea: number; valida: boolean; errores: ErrorDeFila[]; avisos: { codigo: string }[]; apuesta: { event: string; selection: string; odds: number; stake: number; currency: string | null; status: string } | null }[];
  resumen: { validas: number; rechazadas: number; conAvisos: number; omitidas: number };
}

export default function ImportarCsv({ onHecho }: { onHecho: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [vista, setVista] = useState<Vista | null>(null);
  const { t } = useI18n();
  // El error de un campo, en el idioma: por su código si el catálogo lo tiene; si no, el texto del servidor.
  const errorDe = (e: ErrorDeFila) => {
    const k = `apiError.${e.codigo}`;
    const texto = existeClave(k) ? t(k as Clave, e.params) : e.mensaje;
    return e.campo && !texto.startsWith(e.campo) ? `${e.campo}: ${texto}` : texto;
  };
  // Primero se revisa: el servidor dice qué entraría y qué no, sin escribir nada.
  const revisar = async () => {
    setOcupado(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetch('/api/bets/import/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: texto }) });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error ?? String(r.status));
      setVista(j as Vista);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  const importar = async () => {
    setOcupado(true);
    setError(null);
    try {
      // El servidor vuelve a leer y validar el CSV entero: la vista previa no autoriza nada.
      const r = await fetch('/api/bets/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: texto }) });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error ?? String(r.status));
      setRes(j as Resultado);
      setVista(null);
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
        {t('csv.importar')}
      </button>
    );
  }
  return (
    <section className="rounded-xl border border-(--line) bg-(--surface-card) p-4 text-[13px] text-(--ink-soft)">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-(--ink-strong)">{t('csv.titulo')}</h3>
        <button onClick={() => setAbierto(false)} className="text-(--ink-muted) hover:text-(--ink-strong)">{t('csv.cerrar')}</button>
      </div>
      <p className="mb-2">
        {conNodos(t('csv.ayuda'), {
          obligatorias: <code>sport, event, market, selection, odds, stake</code>,
          placed: <code>placed_on</code>,
          opcionales: (
            <>
              <code>league</code>, <code>status</code>, <code>payout</code>, <code>notes</code>, <code>tags</code>
            </>
          ),
          prob: <code>model_prob</code>,
        })}
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label={t('csv.fichero')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then((x) => { setTexto(x); setVista(null); });
        }}
        className="mb-2 block text-[13px]"
      />
      <textarea value={texto} onChange={(e) => { setTexto(e.target.value); setVista(null); }} rows={5} aria-label={t('csv.contenido')} placeholder="sport,event,market,selection,odds,stake" className="w-full rounded-lg border border-(--line) bg-transparent p-2 font-mono text-[12px] text-(--ink-body)" />
      <button onClick={() => void revisar()} disabled={!texto.trim() || ocupado} className="mt-2 rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-50">
        {ocupado && !vista ? t('csv.revisando') : t('csv.revisar')}
      </button>
      {vista && (
        <div role="status" aria-live="polite" className="mt-3 space-y-2">
          {vista.error ? (
            <p style={{ color: STATUS.critical }}>{errorDe(vista.error)}</p>
          ) : (
            <>
              <p className="text-(--ink-body)">{t('csv.vista', { n: vista.resumen.validas, r: vista.resumen.rechazadas })}</p>
              {vista.resumen.omitidas > 0 && <p style={{ color: STATUS.warning }}>{t('csv.omitidas', { n: vista.resumen.omitidas })}</p>}
              {vista.ignoradas.length > 0 && <p>{t('csv.ignoradas', { lista: vista.ignoradas.join(', ') })}</p>}
              {vista.resumen.rechazadas > 0 && (
                <ul className="list-disc pl-5">
                  {vista.filas.filter((f) => !f.valida).slice(0, 50).map((f) => (
                    <li key={f.linea}>{t('csv.linea', { n: f.linea, error: f.errores.map(errorDe).join('; ') })}</li>
                  ))}
                </ul>
              )}
              {vista.resumen.conAvisos > 0 && (
                <>
                  <p className="font-medium text-(--ink-body)">{t('csv.avisosTitulo')}</p>
                  <ul className="list-disc pl-5">
                    {vista.filas.flatMap((f) => f.avisos.map((a) => (
                      <li key={`${f.linea}-${a.codigo}`}>{existeClave(`csv.aviso.${a.codigo}`) ? t(`csv.aviso.${a.codigo}` as Clave, { n: f.linea }) : `${f.linea}: ${a.codigo}`}</li>
                    ))).slice(0, 50)}
                  </ul>
                </>
              )}
              {vista.resumen.validas > 0 && (
                <button onClick={() => void importar()} disabled={ocupado} className="rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-50">
                  {ocupado ? t('csv.importando') : t('csv.importarN', { n: vista.resumen.validas })}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2" style={{ color: STATUS.critical }}>{error}</p>}
      {res && (
        <div role="status" aria-live="polite" className="mt-2">
          <p className="text-(--ink-body)">{t('csv.resultado', { n: res.importadas, rechazadas: res.rechazadas.length ? t('csv.rechazadas', { n: res.rechazadas.length }) : '' })}</p>
          {res.rechazadas.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {res.rechazadas.slice(0, 20).map((r) => (
                <li key={r.linea}>{t('csv.linea', { n: r.linea, error: r.errores?.length ? r.errores.map(errorDe).join('; ') : r.error })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
