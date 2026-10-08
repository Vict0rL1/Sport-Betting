// La UFC en sombra en Diagnóstico: solo con `deportes.ufc` encendido. Enseña la evaluación del
// backtest (sin holdout) y la prueba para publicar, referencia a referencia; nunca una predicción.
import { localeDe, useI18n, type Clave } from '../i18n';
import { useFeature } from '../lib/features';
import { useJson } from '../lib/usarJson';

interface Referencia {
  clave: string;
  nombre: string;
  logLoss: number;
  delta: number;
  lo: number;
  hi: number;
  p: number;
}
interface Tramo {
  n: number;
  modelo: number;
  referencias: Referencia[];
}
interface Sombra {
  peleas: number;
  puntuadas: number;
  holdoutExcluido: number;
  sinAtribuir: number;
  sinGanador: number;
  ultimo: string | null;
  modelo: { n: number; logLoss: number | null; brier: number | null; accuracy: number | null; ece: number | null } | null;
  prueba: { validacion: number; todo: Tramo; enValidacion: Tramo | null; pasa: boolean } | null;
  aviso: { nivel: string; texto: string | null };
  nota: string;
  parametros: { k: number; provisionales: number; factorProvisional: number; bonoFinalizacion: number };
}

const f4 = (x: number | null) => (x == null ? '—' : x.toFixed(4));
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`);
const signo = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(4)}`;
const CLAVES_REF = ['moneda', 'experiencia', 'record', 'basico'] as const;

function TablaTramo({ titulo, tramo }: { titulo: string; tramo: Tramo }) {
  const { t } = useI18n();
  const nombre = (r: Referencia) => ((CLAVES_REF as readonly string[]).includes(r.clave) ? t(`diag.ufcRef.${r.clave}` as Clave) : r.nombre);
  return (
    <div className="mb-2">
      <p className="font-medium text-(--ink-strong)">{titulo}</p>
      <ul className="list-disc pl-5">
        {tramo.referencias.map((r) => (
          <li key={r.clave}>
            {nombre(r)}: {f4(r.logLoss)} · Δ {signo(r.delta)} [{signo(r.lo)}, {signo(r.hi)}] · {r.hi < 0 ? t('diag.ufcGana') : t('diag.ufcNoGana')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Contenido() {
  const { t, idioma } = useI18n();
  const d = useJson<Sombra>('/api/ufc/sombra');
  if (d.error) return <p>{d.error}</p>;
  if (!d.datos) return null;
  const s = d.datos;
  const n = (x: number) => x.toLocaleString(localeDe(idioma));
  return (
    <>
      <p className="mb-1">{t('diag.ufcIntro')}</p>
      <p className="mb-1">
        {t('diag.ufcPeleas', { peleas: n(s.peleas), ultimo: s.ultimo ?? '—', puntuadas: n(s.puntuadas), holdout: n(s.holdoutExcluido), sinAtribuir: n(s.sinAtribuir), sinGanador: n(s.sinGanador) })}
      </p>
      {s.modelo && <p className="mb-1">{t('diag.ufcModelo', { ll: f4(s.modelo.logLoss), brier: f4(s.modelo.brier), acierto: pct(s.modelo.accuracy) })}</p>}
      {s.prueba && (
        <>
          <p className="mb-1 font-medium" data-testid="ufc-veredicto">
            {s.prueba.pasa ? t('diag.ufcPasa') : t('diag.ufcNoPasa')}
          </p>
          <TablaTramo titulo={t('diag.ufcTodo', { n: n(s.prueba.todo.n), ll: f4(s.prueba.todo.modelo) })} tramo={s.prueba.todo} />
          {s.prueba.enValidacion && (
            <TablaTramo titulo={t('diag.ufcValidacion', { anio: s.prueba.validacion, n: n(s.prueba.enValidacion.n), ll: f4(s.prueba.enValidacion.modelo) })} tramo={s.prueba.enValidacion} />
          )}
        </>
      )}
      {s.aviso.texto && <p className="mb-1">{s.aviso.texto}</p>}
      <p className="mb-1">
        {t('diag.ufcParametros', { k: s.parametros.k, provisionales: s.parametros.provisionales, factor: s.parametros.factorProvisional.toLocaleString(localeDe(idioma)) })}
      </p>
      <p className="text-(--ink-muted)">{s.nota}</p>
    </>
  );
}

export default function UfcSombra() {
  const { t } = useI18n();
  const on = useFeature('deportes.ufc');
  if (!on) return null;
  return (
    <section className="mb-4 rounded-xl border border-(--line) p-4" data-testid="ufc-sombra">
      <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('diag.ufc')}</h3>
      <div className="text-[13px] leading-relaxed text-(--ink-soft)">
        <Contenido />
      </div>
    </section>
  );
}
