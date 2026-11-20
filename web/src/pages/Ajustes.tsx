// Ajustes (Fase 5.7). Lo que cambia un número enseña «antes → después» y pide confirmación:
// la política crea una versión nueva (nunca reescribe), los interruptores se anulan con
// registro, las cadencias cambian el temporizador, y el tema y el idioma son de la persona.

import { useEffect, useRef, useState } from 'react';
import NotificacionesPanel from '../components/auth/NotificacionesPanel';
import { aplicarTema, type Tema } from '../lib/tema';
import { guardarZona, leerZona, zonaValida } from '../lib/zona';
import { zonaDelNavegador } from '../lib/explorador';
import { DEPORTES } from '../rutas';
import { ETIQUETA_POLITICA } from '../lib/politica';
import { conNodos, localeDe, useI18n, type Clave, type Idioma, type Traducir } from '../i18n';
import { useDialogo } from '../components/ui/useDialogo';
import { FalloCarga, useCarga } from '../components/ui/carga';
import { datosDe, pedirJson } from '../lib/remoto';
import { borradorTrasAplicar, CADENCIA_MAX, CADENCIA_MIN, errorDeRespuesta, leerImporte, validarCadencia } from '../lib/ajustes';

interface Version { id: number; created_at: string; parent_id: number | null; hash: string; nota: string | null; origen: string; config: Record<string, Record<string, number>> }
interface Feature { on: boolean; activa: boolean; descripcion: string; falta: string | null; anulada: boolean; soloArranque?: boolean }
interface Trabajo { nombre: string; descripcion: string; cadenciaMin: number; cadenciaPorDefecto: number; enabled: boolean }
/** Horas de silencio de los avisos externos (G3). Ver server/src/notifications/silencio.ts. */
interface Silencio { activo: boolean; desde: string; hasta: string; zona: string; modo: 'suprimir' | 'aplazar'; caducaHoras: number }
interface Ajustes { deportesOcultos: string[]; tema: Tema; idioma: Idioma; bancoPersonal: number | null; recorridoVisto: boolean; silencio?: Silencio | null }

/**
 * Horas de silencio (G3): opcionales. Solo callan los canales externos; la bandeja lo recibe todo.
 * Desde = hasta no es una ventana y no se deja guardar (el servidor tampoco lo acepta).
 */
function HorasDeSilencio({ actual, guardar }: { actual: Silencio | null; guardar: (c: Partial<Ajustes>) => Promise<void> }) {
  const { t } = useI18n();
  const [s, setS] = useState<Silencio>(actual ?? { activo: false, desde: '23:00', hasta: '07:00', zona: leerZona(), modo: 'aplazar', caducaHoras: 12 });
  const [guardado, setGuardado] = useState(false);
  const iguales = s.desde === s.hasta;
  const cambiar = (c: Partial<Silencio>) => {
    setS({ ...s, ...c });
    setGuardado(false);
  };
  return (
    <div className="mt-4 border-t border-(--line) pt-3">
      <h4 className="text-[14px] font-semibold text-(--ink-strong)">{t('silencio.titulo')}</h4>
      <p className="mb-2 text-[12px] text-(--ink-muted)">{t('silencio.nota')}</p>
      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" checked={s.activo} onChange={(e) => cambiar({ activo: e.target.checked })} />
        <span>{t('silencio.activar')}</span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[12px]">
          {t('silencio.desde')}
          <input type="time" value={s.desde} onChange={(e) => cambiar({ desde: e.target.value })} className="h-9 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)" />
        </label>
        <label className="flex flex-col text-[12px]">
          {t('silencio.hasta')}
          <input type="time" value={s.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} className="h-9 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)" />
        </label>
        <label className="flex flex-col text-[12px]">
          {t('silencio.modo')}
          <select value={s.modo} onChange={(e) => cambiar({ modo: e.target.value as Silencio['modo'] })} className="h-9 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)">
            <option value="aplazar">{t('silencio.aplazar')}</option>
            <option value="suprimir">{t('silencio.suprimir')}</option>
          </select>
        </label>
        {s.modo === 'aplazar' && (
          <label className="flex flex-col text-[12px]">
            {t('silencio.caduca')}
            <input type="number" min={1} max={72} value={s.caducaHoras} onChange={(e) => cambiar({ caducaHoras: Number(e.target.value) })} className="h-9 w-20 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)" />
          </label>
        )}
      </div>
      <p className="mt-2 text-[12px] text-(--ink-muted)">{t('silencio.zona', { zona: s.zona })}</p>
      {iguales && <p role="alert" className="mt-1 text-[12px] text-(--status-critical)">{t('silencio.iguales')}</p>}
      <p className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={iguales}
          onClick={() => void guardar({ silencio: s.activo ? { ...s, caducaHoras: Math.min(72, Math.max(1, Math.round(s.caducaHoras) || 12)) } : null }).then(() => setGuardado(true))}
          className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line-strong) hover:bg-(--raised) disabled:opacity-50"
        >
          {t('silencio.guardar')}
        </button>
        {guardado && <span className="text-[12px] text-(--ink-muted)" role="status">{t('silencio.guardado')}</span>}
      </p>
    </div>
  );
}

const etiquetaPolitica = (t: Traducir, clave: string) => (ETIQUETA_POLITICA[clave] ? t(ETIQUETA_POLITICA[clave]) : clave);

/** La zona con la que se leen horas y días (TZ-1): la del navegador o una fijada en este aparato. */
function ZonaHoraria() {
  const { t } = useI18n();
  const [zona, setZona] = useState(leerZona());
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(false);
  const fijada = zona !== zonaDelNavegador();
  const aplicar = (z: string | null) => {
    if (z != null && !zonaValida(z)) {
      setError(true);
      return;
    }
    guardarZona(z);
    setZona(leerZona());
    setError(false);
    setTexto('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{t('ajustes.zonaActual', { zona })}{fijada ? '' : ` (${t('ajustes.zonaDelNavegador')})`}</span>
      <label className="flex items-center gap-2">
        <span className="sr-only">{t('ajustes.zona')}</span>
        <input value={texto} onChange={(e) => { setTexto(e.target.value); setError(false); }} placeholder="Europe/Madrid" aria-invalid={error || undefined} className="w-48 rounded border border-(--line) bg-transparent px-2 py-1 text-(--ink-strong)" />
      </label>
      <button type="button" onClick={() => aplicar(texto.trim())} disabled={!texto.trim()} className="rounded-full px-3 py-1 ring-1 ring-(--line-strong) hover:bg-(--raised) disabled:opacity-50">{t('ajustes.zonaFijar')}</button>
      {fijada && <button type="button" onClick={() => aplicar(null)} className="rounded-full px-3 py-1 ring-1 ring-(--line) hover:bg-(--raised)">{t('ajustes.zonaVolver')}</button>}
      {error && <span role="alert" className="text-(--status-critical)">{t('ajustes.zonaInvalida')}</span>}
    </div>
  );
}

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
  const { t } = useI18n();
  const dialogo = useRef<HTMLDivElement>(null);
  useDialogo(true, onNo, dialogo);
  return (
    <div ref={dialogo} role="dialog" aria-modal="true" aria-label={t('aj.confirmarCambios')} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-(--line) bg-(--surface-card) p-4 text-[13px] text-(--ink-soft)">
        <p className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('aj.aplicarPregunta')}</p>
        <ul className="mb-3 space-y-1">
          {cambios.map((c) => (
            <li key={c.etiqueta} className="flex flex-wrap justify-between gap-x-3">
              <span>{c.etiqueta}</span>
              <span className="tabular-nums text-(--ink-body)">{c.antes} → <strong className="text-(--ink-strong)">{c.despues}</strong></span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onNo} className="rounded-lg px-3 py-1.5 text-(--ink-soft) ring-1 ring-(--line) hover:bg-(--raised)">{t('comun.cancelar')}</button>
          <button onClick={onOk} disabled={ocupado} className="rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) hover:bg-(--line-strong) disabled:opacity-50">{ocupado ? t('aj.aplicando') : t('comun.aplicar')}</button>
        </div>
      </div>
    </div>
  );
}

/** Coma decimal en español (como estaba), punto en inglés; al leer se aceptan las dos. */
const fmt = (v: unknown, idioma: Idioma) => (typeof v === 'number' ? (idioma === 'es' ? String(v).replace('.', ',') : String(v)) : String(v));

function Politica() {
  const { t, idioma } = useI18n();
  const [v, setV] = useState<{ vigente: Version; historial: Version[] } | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargar = () => fetch('/api/policy').then((r) => (r.ok ? r.json() : Promise.reject())).then(setV).catch(() => setError(t('aj.errorPolitica')));
  useEffect(() => {
    void cargar();
  }, []);
  if (error) return <p>{error}</p>;
  if (!v) return <p>{t('comun.cargando')}</p>;
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
      setError(t('aj.noAplico', { error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status }));
      return;
    }
    setBorrador({});
    setError(null);
    void cargar();
  };
  return (
    <>
      <p className="mb-2">{t('aj.version', { id: v.vigente.id, origen: v.vigente.origen, fecha: new Date(v.vigente.created_at).toLocaleDateString(localeDe(idioma)), sig: v.vigente.id + 1 })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {campos.map((c) => (
          <label key={c.clave} className="flex items-center justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
            <span>{etiquetaPolitica(t, c.clave)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={borrador[c.clave] ?? fmt(c.actual, idioma)}
              onChange={(e) => setBorrador((b) => ({ ...b, [c.clave]: e.target.value }))}
              className="w-24 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)"
              aria-label={etiquetaPolitica(t, c.clave)}
            />
          </label>
        ))}
      </div>
      <button onClick={() => setConfirmar(true)} disabled={cambios.length === 0} className="mt-3 rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-40">
        {t('aj.revisar', { n: cambios.length })}
      </button>
      {confirmar && <Confirmar ocupado={ocupado} onNo={() => setConfirmar(false)} onOk={() => void aplicar()} cambios={cambios.map((c) => ({ etiqueta: etiquetaPolitica(t, c.clave), antes: fmt(c.actual, idioma), despues: fmt(c.nuevo, idioma) }))} />}
    </>
  );
}

function Interruptores() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  // Un fallo no es «ningún interruptor» ni un «Cargando…» eterno (fase C): se dice y se reintenta.
  const { estado, recargar: cargar } = useCarga(() => pedirJson('/api/features', (j) => {
    const x = (j as { features?: Record<string, Feature> }).features;
    if (!x || typeof x !== 'object') throw new Error('forma');
    return x;
  }), []);
  const f = datosDe(estado);
  if (!f) return estado.fase === 'error' ? <FalloCarga que={t('carga.queInterruptores')} onReintentar={cargar} /> : <p>{t('comun.cargando')}</p>;
  const cambiar = async (nombre: string, on: boolean | null) => {
    // D11: un PATCH rechazado ya no se traga en silencio.
    const r = await fetch(`/api/features/${encodeURIComponent(nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) }).catch(() => null);
    const e = r ? await errorDeRespuesta(r) : t('aj.sinRed');
    setError(e ? t('aj.noAplico', { error: e }) : null);
    void cargar();
  };
  // La puerta, las cabeceras de seguridad (auth.*, seguridad.*) y la política versionada solo cambian al arrancar: la API
  // las rechaza y aquí no hay interruptor que pulsar, solo se dice dónde están.
  const deArranque = Object.keys(f).filter((k) => f[k].soloArranque);
  return (
    <ul className="space-y-1.5">
      {error && <li role="alert" className="rounded-lg border border-[#e66767]/40 px-3 py-2 text-[13px] text-(--status-critical)">{error}</li>}
      {deArranque.length > 0 && <li className="text-[12px] text-(--ink-muted)">{conNodos(t('aj.deArranque', { lista: '{lista}' }), { lista: <code className="font-mono">{deArranque.join(', ')}</code> })}</li>}
      {Object.entries(f).filter(([, x]) => !x.soloArranque).map(([k, x]) => (
        <li key={k} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
          <div className="min-w-0 flex-1">
            {/* El nombre del interruptor es un identificador de configuración (config/features.json,
                npm run features), no texto que traducir: va como código (E8). */}
            <p className="text-(--ink-body)"><code className="font-mono text-[12px]">{k}</code>{x.anulada && <span className="ml-1.5 text-[11px] text-(--ink-muted)">{t('aj.anulado')}</span>}{x.falta && <span className="ml-1.5 text-[11px]" style={{ color: 'var(--status-warning)' }}>{t('notif.falta', { vars: x.falta })}</span>}</p>
            <p className="text-[12px] text-(--ink-muted)">{x.descripcion}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button role="switch" aria-checked={x.on} aria-label={`${k}: ${x.on ? t('aj.encendido') : t('aj.apagado')}`} onClick={() => void cambiar(k, !x.on)} className={`relative h-6 w-11 rounded-full transition ${x.on ? 'bg-[#199e70]' : 'bg-(--raised-2)'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${x.on ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
            {x.anulada && <button onClick={() => void cambiar(k, null)} className="text-[11px] text-(--ink-muted) underline-offset-2 hover:underline">{t('aj.quitar')}</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Cadencias() {
  const { t } = useI18n();
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [pendiente, setPendiente] = useState<{ nombre: string; antes: number; despues: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { estado, recargar: cargar } = useCarga(() => pedirJson('/api/scheduler', (j) => {
    const x = (j as { trabajos?: Trabajo[] }).trabajos;
    if (!Array.isArray(x)) throw new Error('forma');
    return x;
  }), []);
  const trabajos = datosDe(estado);
  if (!trabajos) return estado.fase === 'error' ? <FalloCarga que={t('carga.queCadencias')} onReintentar={cargar} /> : <p>{t('comun.cargando')}</p>;
  const aplicar = async () => {
    if (!pendiente) return;
    const r = await fetch(`/api/scheduler/${encodeURIComponent(pendiente.nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cadenciaMin: pendiente.despues }) }).catch(() => null);
    const e = r ? await errorDeRespuesta(r) : t('aj.sinRed');
    setPendiente(null);
    setError(e ? t('aj.noAplico', { error: e }) : null);
    // D11: el borrador se olvida (antes quedaba '' y el campo se veía vacío).
    if (!e) setBorrador((b) => borradorTrasAplicar(b, pendiente.nombre));
    void cargar();
  };
  const conmutar = async (x: Trabajo) => {
    const r = await fetch(`/api/scheduler/${encodeURIComponent(x.nombre)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !x.enabled }) }).catch(() => null);
    const e = r ? await errorDeRespuesta(r) : t('aj.sinRed');
    setError(e ? t('aj.noAplico', { error: e }) : null);
    void cargar();
  };
  const pedirCambio = (x: Trabajo) => {
    const v = validarCadencia(borrador[x.nombre] ?? String(x.cadenciaMin));
    if (!v.ok) {
      setError(t('aj.cadenciaFuera', { min: CADENCIA_MIN, max: CADENCIA_MAX }));
      return;
    }
    setError(null);
    if (v.minutos !== x.cadenciaMin) setPendiente({ nombre: x.nombre, antes: x.cadenciaMin, despues: v.minutos });
  };
  return (
    <>
      {error && <p role="alert" className="mb-2 rounded-lg border border-[#e66767]/40 px-3 py-2 text-[13px] text-(--status-critical)">{error}</p>}
      <ul className="space-y-1.5">
        {trabajos.map((x) => (
          <li key={x.nombre} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-(--raised) px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-(--ink-body)">{x.nombre} {!x.enabled && <span className="text-[11px] text-(--ink-muted)">{t('aj.apagadoParen')}</span>}</p>
              <p className="text-[12px] text-(--ink-muted)">{x.descripcion}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-[12px]">
                {t('aj.cada')}
                <input type="text" inputMode="numeric" aria-label={t('aj.cadenciaDe', { nombre: x.nombre })} value={borrador[x.nombre] ?? String(x.cadenciaMin)} onChange={(e) => setBorrador((b) => ({ ...b, [x.nombre]: e.target.value }))} className="w-16 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)" />
                min
              </label>
              <button onClick={() => pedirCambio(x)} className="rounded px-2 py-1 text-[12px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised-2)">{t('ajustes.cambiar')}</button>
              {x.cadenciaMin !== x.cadenciaPorDefecto && <button onClick={() => setPendiente({ nombre: x.nombre, antes: x.cadenciaMin, despues: null })} className="text-[11px] text-(--ink-muted) underline-offset-2 hover:underline">{t('aj.codigo', { n: x.cadenciaPorDefecto })}</button>}
              <button onClick={() => void conmutar(x)} className="rounded px-2 py-1 text-[12px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised-2)">{x.enabled ? t('aj.apagar') : t('aj.encender')}</button>
            </div>
          </li>
        ))}
      </ul>
      {pendiente && <Confirmar ocupado={false} onNo={() => setPendiente(null)} onOk={() => void aplicar()} cambios={[{ etiqueta: t('aj.cadenciaEtiqueta', { nombre: pendiente.nombre }), antes: `${pendiente.antes} min`, despues: pendiente.despues == null ? t('aj.laDelCodigo') : `${pendiente.despues} min` }]} />}
    </>
  );
}

export default function Ajustes() {
  const { t, idioma, setIdioma } = useI18n();
  const [a, setA] = useState<Ajustes | null>(null);
  // null = sin tocar (el campo enseña lo guardado); '' = vaciado a propósito (sin banco).
  const [banco, setBanco] = useState<string | null>(null);
  const [confirmarBanco, setConfirmarBanco] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/ajustes').then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { ajustes: Ajustes }) => setA(j.ajustes)).catch(() => setError(t('aj.errorAjustes')));
  }, []);
  const guardar = async (cambios: Partial<Ajustes>) => {
    const r = await fetch('/api/ajustes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cambios) });
    if (!r.ok) {
      setError(t('aj.noGuardo', { error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status }));
      return;
    }
    setError(null);
    setA(((await r.json()) as { ajustes: Ajustes }).ajustes);
  };
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-semibold text-(--ink-strong)">{t('ajustes.titulo')}</h2>
      <p className="mb-4 text-[13px] text-(--ink-muted)">{t('ajustes.intro')}</p>
      {error && <p role="alert" className="mb-3 rounded-lg border border-[#e66767]/40 px-3 py-2 text-[13px] text-(--status-critical)">{error}</p>}

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

      <span id="zona" />
      <Seccion titulo={t('ajustes.zona')} nota={t('ajustes.zonaNota', { navegador: zonaDelNavegador() })}>
        <ZonaHoraria />
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
          <input type="text" inputMode="decimal" aria-label={t('ajustes.banco')} value={banco ?? (a?.bancoPersonal != null ? fmt(a.bancoPersonal, idioma) : '')} onChange={(e) => setBanco(e.target.value)} placeholder={t('aj.ejemplo')} className="w-32 rounded border border-(--line) bg-transparent px-2 py-1 text-right tabular-nums text-(--ink-strong)" />
          <button onClick={() => setConfirmarBanco(true)} disabled={banco == null || (banco.trim() !== '' && leerImporte(banco) == null)} className="rounded-lg bg-(--raised-2) px-3 py-1.5 font-medium text-(--ink-strong) disabled:opacity-40">{t('ajustes.cambiar')}</button>
        </div>
        {confirmarBanco && a && (
          <Confirmar ocupado={false} onNo={() => setConfirmarBanco(false)} onOk={() => { void guardar({ bancoPersonal: leerImporte(banco ?? '') }); setConfirmarBanco(false); setBanco(null); }} cambios={[{ etiqueta: t('ajustes.banco'), antes: a.bancoPersonal == null ? '—' : fmt(a.bancoPersonal, idioma), despues: leerImporte(banco ?? '') == null ? '—' : fmt(leerImporte(banco ?? ''), idioma) }]} />
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
        {a && <HorasDeSilencio actual={a.silencio ?? null} guardar={guardar} />}
      </Seccion>

      <Seccion titulo={t('ajustes.interruptores')} nota={t('ajustes.interruptoresNota')}>
        <Interruptores />
      </Seccion>
    </div>
  );
}
