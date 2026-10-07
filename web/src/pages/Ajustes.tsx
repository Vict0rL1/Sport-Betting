// Ajustes (Fase 5.7). Lo que cambia un número enseña «antes → después» y pide confirmación:
// la política crea una versión nueva (nunca reescribe), los interruptores se anulan con
// registro, las cadencias cambian el temporizador, y el tema y el idioma son de la persona.

import { useEffect, useState } from 'react';
import NotificacionesPanel from '../components/auth/NotificacionesPanel';
import { aplicarTema, type Tema } from '../lib/tema';
import { DEPORTES } from '../rutas';
import { useI18n, type Clave, type Idioma } from '../i18n';

interface Version { id: number; created_at: string; parent_id: number | null; hash: string; nota: string | null; origen: string; config: Record<string, Record<string, number>> }
interface Feature { on: boolean; activa: boolean; descripcion: string; falta: string | null; anulada: boolean }
interface Trabajo { nombre: string; descripcion: string; cadenciaMin: number; cadenciaPorDefecto: number; enabled: boolean }
interface Ajustes { deportesOcultos: string[]; tema: Tema; idioma: Idioma; bancoPersonal: number | null; recorridoVisto: boolean }

const ETIQUETA_POLITICA: Record<string, string> = {
  'staking.kellyFraction': 'Fracción de Kelly',
  'staking.maxPerEvent': 'Máximo por partido (fracción del banco)',
  'staking.dailyLossLimit': 'Pérdida máxima diaria',
  'staking.weeklyLossLimit': 'Pérdida máxima semanal',
  'staking.minEdge': 'Ventaja mínima para apostar',
  'staking.maxTotalExposure': 'Exposición total máxima',
  'staking.maxExposurePerDay': 'Exposición máxima por día',
  'abstencion.calidadDatosMin': 'Calidad de datos mínima (0–100)',
};

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-(--line) p-4">
      <h3 className="text-[15px] font-semibold text-(--ink-strong)">{titulo}</h3>
      {nota && <p className="mb-2 text-[12px] text-(--ink-muted)">{nota}</p>}
      <div className="mt-2 text-[13px] leading-relaxed text-(--ink-soft)">{children}</div>
    </section>
  );
}

/** El diálogo «antes → después»: nada numérico cambia sin pasar por aquí. */
function Confirmar({ cambios, onOk, onNo, ocupado }: { cambios: { etiqueta: string; antes: string; despues: string }[]; onOk: () => void; onNo: () => void; ocupado: boolean }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Confirmar cambios" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-(--line) bg-(--surface-card) p-4 text-[13px] text-(--ink-soft)">
        <p className="mb-2 text-[15px] font-semibold text-(--ink-strong)">¿Aplicar estos cambios?</p>
        <ul className="mb-3 space-y-1">
          {cambios.map((c) => (
            <li key={c.etiqueta} className="flex flex-wrap justify-between gap-x-3">
              <span>{c.etiqueta}</span>
              <span className="tabular-nums text-(--ink-body)">{c.antes} → <strong className="text-(--ink-strong)">{c.despues}</strong></span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onNo} className="rounded-lg px-3 py-1.5 text-(--ink-soft) ring-1 ring-(--line) hover:bg-(--raised)">Cancelar</button>
          <button onClick={onOk} disabled={ocupado} className="rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) hover:bg-(--line-strong) disabled:opacity-50">{ocupado ? 'Aplicando…' : 'Aplicar'}</button>
        </div>
      </div>
    </div>
  );
}

const fmt = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : String(v));

function Politica() {
  const [v, setV] = useState<{ vigente: Version; historial: Version[] } | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargar = () => fetch('/api/policy').then((r) => (r.ok ? r.json() : Promise.reject())).then(setV).catch(() => setError('No se pudo leer la política.'));
  useEffect(() => {
    void cargar();
  }, []);
  if (error) return <p>{error}</p>;
  if (!v) return <p>Cargando…</p>;
  const campos = Object.entries(v.vigente.config).flatMap(([grupo, obj]) => Object.entries(obj).filter(([, x]) => typeof x === 'number').map(([k, x]) => ({ clave: `${grupo}.${k}`, grupo, k, actual: x as number })));
  const cambios = campos
    .filter((c) => borrador[c.clave] != null && borrador[c.clave] !== '' && Number(borrador[c.clave].replace(',', '.')) !== c.actual)
    .map((c) => ({ ...c, nuevo: Number(borrador[c.clave].replace(',', '.')) }))
    .filter((c) => Number.isFinite(c.nuevo));
  const aplicar = async () => {
    setOcupado(true);
    const body: Record<string, Record<string, number>> = {};
    for (const c of cambios) (body[c.grupo] ??= {})[c.k] = c.nuevo;
    const r = await fetch('/api/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cambios: body, nota: 'desde Ajustes' }) });
    setOcupado(false);
    setConfirmar(false);
    if (!r.ok) {
      setError(`No se aplicó: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      return;
    }
    setBorrador({});
    setError(null);
    void cargar();
  };
  return (
    <>
      <p className="mb-2">Versión {v.vigente.id} ({v.vigente.origen}, {new Date(v.vigente.created_at).toLocaleDateString('es')}). Cambiar crea la versión {v.vigente.id + 1}; las apuestas ya hechas conservan la suya.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {campos.map((c) => (
          <label key={c.clave} className="flex items-center justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
            <span>{ETIQUETA_POLITICA[c.clave] ?? c.clave}</span>
            <input
              type="text"
              inputMode="decimal"
              value={borrador[c.clave] ?? fmt(c.actual)}
              onChange={(e) => setBorrador((b) => ({ ...b, [c.clave]: e.target.value }))}
              className="w-24 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)"
              aria-label={ETIQUETA_POLITICA[c.clave] ?? c.clave}
            />
          </label>
        ))}
      </div>
      <button onClick={() => setConfirmar(true)} disabled={cambios.length === 0} className="mt-3 rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-40">
        Revisar {cambios.length} cambio(s)
      </button>
      {confirmar && <Confirmar ocupado={ocupado} onNo={() => setConfirmar(false)} onOk={() => void aplicar()} cambios={cambios.map((c) => ({ etiqueta: ETIQUETA_POLITICA[c.clave] ?? c.clave, antes: fmt(c.actual), despues: fmt(c.nuevo) }))} />}
    </>
  );
}

function Interruptores() {
  const [f, setF] = useState<Record<string, Feature> | null>(null);
  const cargar = () => fetch('/api/features').then((r) => r.json()).then((j: { features: Record<string, Feature> }) => setF(j.features)).catch(() => setF({}));
  useEffect(() => {
    void cargar();
  }, []);
  if (!f) return <p>Cargando…</p>;
  const cambiar = async (nombre: string, on: boolean | null) => {
    await fetch(`/api/features/${encodeURIComponent(nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
    void cargar();
  };
  return (
    <ul className="space-y-1.5">
      {Object.entries(f).map(([k, x]) => (
        <li key={k} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-(--ink-body)">{k}{x.anulada && <span className="ml-1.5 text-[11px] text-(--ink-muted)">(anulado en Ajustes)</span>}{x.falta && <span className="ml-1.5 text-[11px]" style={{ color: '#c98500' }}>falta {x.falta}</span>}</p>
            <p className="text-[12px] text-(--ink-muted)">{x.descripcion}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button role="switch" aria-checked={x.on} aria-label={`${k}: ${x.on ? 'encendido' : 'apagado'}`} onClick={() => void cambiar(k, !x.on)} className={`relative h-6 w-11 rounded-full transition ${x.on ? 'bg-[#199e70]' : 'bg-(--raised-2)'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${x.on ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
            {x.anulada && <button onClick={() => void cambiar(k, null)} className="text-[11px] text-(--ink-muted) underline-offset-2 hover:underline">quitar</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Cadencias() {
  const [t, setT] = useState<Trabajo[] | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [pendiente, setPendiente] = useState<{ nombre: string; antes: number; despues: number | null } | null>(null);
  const cargar = () => fetch('/api/scheduler').then((r) => r.json()).then((j: { trabajos: Trabajo[] }) => setT(j.trabajos)).catch(() => setT([]));
  useEffect(() => {
    void cargar();
  }, []);
  if (!t) return <p>Cargando…</p>;
  const aplicar = async () => {
    if (!pendiente) return;
    await fetch(`/api/scheduler/${encodeURIComponent(pendiente.nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cadenciaMin: pendiente.despues }) });
    setPendiente(null);
    setBorrador((b) => ({ ...b, [pendiente.nombre]: '' }));
    void cargar();
  };
  return (
    <>
      <ul className="space-y-1.5">
        {t.map((x) => (
          <li key={x.nombre} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-(--ink-body)">{x.nombre} {!x.enabled && <span className="text-[11px] text-(--ink-muted)">(apagado)</span>}</p>
              <p className="text-[12px] text-(--ink-muted)">{x.descripcion}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-[12px]">
                cada
                <input type="text" inputMode="numeric" aria-label={`Cadencia de ${x.nombre} en minutos`} value={borrador[x.nombre] ?? String(x.cadenciaMin)} onChange={(e) => setBorrador((b) => ({ ...b, [x.nombre]: e.target.value }))} className="w-16 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)" />
                min
              </label>
              <button onClick={() => { const n = Number(borrador[x.nombre]); if (Number.isFinite(n) && n >= 1 && n !== x.cadenciaMin) setPendiente({ nombre: x.nombre, antes: x.cadenciaMin, despues: n }); }} className="rounded px-2 py-1 text-[12px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised-2)">Cambiar</button>
              {x.cadenciaMin !== x.cadenciaPorDefecto && <button onClick={() => setPendiente({ nombre: x.nombre, antes: x.cadenciaMin, despues: null })} className="text-[11px] text-(--ink-muted) underline-offset-2 hover:underline">código ({x.cadenciaPorDefecto})</button>}
              <button onClick={async () => { await fetch(`/api/scheduler/${encodeURIComponent(x.nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !x.enabled }) }); void cargar(); }} className="rounded px-2 py-1 text-[12px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised-2)">{x.enabled ? 'Apagar' : 'Encender'}</button>
            </div>
          </li>
        ))}
      </ul>
      {pendiente && <Confirmar ocupado={false} onNo={() => setPendiente(null)} onOk={() => void aplicar()} cambios={[{ etiqueta: `Cadencia de ${pendiente.nombre}`, antes: `${pendiente.antes} min`, despues: pendiente.despues == null ? 'la del código' : `${pendiente.despues} min` }]} />}
    </>
  );
}

export default function Ajustes() {
  const { t, idioma, setIdioma } = useI18n();
  const [a, setA] = useState<Ajustes | null>(null);
  const [banco, setBanco] = useState('');
  const [confirmarBanco, setConfirmarBanco] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/ajustes').then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { ajustes: Ajustes }) => setA(j.ajustes)).catch(() => setError('No se pudieron leer los ajustes.'));
  }, []);
  const guardar = async (cambios: Partial<Ajustes>) => {
    const r = await fetch('/api/ajustes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cambios) });
    if (!r.ok) {
      setError(`No se guardó: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      return;
    }
    setError(null);
    setA(((await r.json()) as { ajustes: Ajustes }).ajustes);
  };
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-semibold text-(--ink-strong)">{t('ajustes.titulo')}</h2>
      <p className="mb-4 text-[13px] text-(--ink-muted)">{t('ajustes.intro')}</p>
      {error && <p className="mb-3 rounded-lg border border-[#e66767]/40 px-3 py-2 text-[13px] text-[#e66767]">{error}</p>}

      <Seccion titulo={t('ajustes.apariencia')} nota={t('ajustes.aparienciaNota')}>
        <div className="flex flex-wrap gap-2">
          {(['auto', 'oscuro', 'claro'] as Tema[]).map((x) => (
            <button key={x} aria-pressed={(a?.tema ?? 'auto') === x} onClick={() => { aplicarTema(x); void guardar({ tema: x }); }} className={`rounded-full px-3 py-1 ring-1 ${(a?.tema ?? 'auto') === x ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'}`}>
              {t(`tema.${x}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['es', 'en'] as Idioma[]).map((x) => (
            <button key={x} aria-pressed={idioma === x} onClick={() => { setIdioma(x); void guardar({ idioma: x }); }} className={`rounded-full px-3 py-1 ring-1 ${idioma === x ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'}`}>
              {x === 'es' ? 'Español' : 'English'}
            </button>
          ))}
        </div>
      </Seccion>

      <Seccion titulo={t('ajustes.deportes')} nota={t('ajustes.deportesNota')}>
        <div className="flex flex-wrap gap-2">
          {DEPORTES.map((d) => {
            const oculto = a?.deportesOcultos.includes(d) ?? false;
            return (
              <button key={d} aria-pressed={!oculto} onClick={() => a && void guardar({ deportesOcultos: oculto ? a.deportesOcultos.filter((x) => x !== d) : [...a.deportesOcultos, d] })} className={`rounded-full px-3 py-1 ring-1 ${!oculto ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-muted) ring-(--line) line-through'}`}>
                {t(`deporte.${d}` as Clave)}
              </button>
            );
          })}
        </div>
      </Seccion>

      <Seccion titulo={t('ajustes.banco')} nota={t('ajustes.bancoNota')}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" inputMode="decimal" aria-label={t('ajustes.banco')} value={banco || (a?.bancoPersonal != null ? fmt(a.bancoPersonal) : '')} onChange={(e) => setBanco(e.target.value)} placeholder="p. ej. 500" className="w-32 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)" />
          <button onClick={() => setConfirmarBanco(true)} disabled={!banco || !Number.isFinite(Number(banco.replace(',', '.')))} className="rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-40">{t('ajustes.cambiar')}</button>
        </div>
        {confirmarBanco && a && (
          <Confirmar ocupado={false} onNo={() => setConfirmarBanco(false)} onOk={() => { void guardar({ bancoPersonal: Number(banco.replace(',', '.')) }); setConfirmarBanco(false); setBanco(''); }} cambios={[{ etiqueta: t('ajustes.banco'), antes: a.bancoPersonal == null ? '—' : fmt(a.bancoPersonal), despues: banco }]} />
        )}
      </Seccion>

      <Seccion titulo={t('ajustes.politica')} nota={t('ajustes.politicaNota')}>
        <Politica />
      </Seccion>

      <Seccion titulo={t('ajustes.cadencias')} nota={t('ajustes.cadenciasNota')}>
        <Cadencias />
      </Seccion>

      <Seccion titulo={t('ajustes.notificaciones')}>
        <NotificacionesPanel />
      </Seccion>

      <Seccion titulo={t('ajustes.interruptores')} nota={t('ajustes.interruptoresNota')}>
        <Interruptores />
      </Seccion>
    </div>
  );
}
