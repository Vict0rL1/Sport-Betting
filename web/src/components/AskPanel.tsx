// El asistente, en pantalla.
//
// ===========================================================================
// LO QUE ESTA INTERFAZ TIENE QUE DEJAR CLARO
// ===========================================================================
// Un recuadro donde se escribe y sale texto SE LEE como un chatbot, y un chatbot invita
// a creerse lo que dice. Aquí pasa lo contrario: el asistente no redacta ni un número,
// solo elige qué consulta correr, y el número sale de la base.
//
// Esa diferencia no se nota si no se enseña, así que se enseña: cada respuesta lleva
// debajo DE DÓNDE sale, y arriba se dice, sin adornos, que no hay ningún modelo de
// lenguaje detrás. Prometer menos de lo que se hace es la única forma de que lo que se
// dice valga algo.

import { useState } from 'react';
import { conNodos, useI18n } from '../i18n';

interface Respuesta {
  texto: string;
  filas?: { etiqueta: string; valor: string }[];
  fuente: string;
  intencion: { herramienta: string; argumentos: string[] };
  /** Quién eligió la consulta: el agente, un modelo de lenguaje, o las reglas. */
  via?: 'agente' | 'modelo' | 'determinista';
  nota?: string;
  plan?: string;
  /** Las consultas que se encadenaron, cuando fue más de una. */
  pasos?: { herramienta: string; argumentos: string[]; respuesta: { texto: string; filas?: { etiqueta: string; valor: string }[]; fuente: string } }[];
}

const EJEMPLOS = [
  'Alcaraz',
  'cara a cara Alcaraz contra Sinner',
  'quién gana Sinner contra Djokovic en tierra',
  'top 10 ATP',
  'estado de los datos',
  'qué precisión tiene el modelo',
  'compara a Alcaraz y Sinner',
];

export default function AskPanel() {
  const { t, idioma } = useI18n();
  const [q, setQ] = useState('');
  const [hilo, setHilo] = useState<{ pregunta: string; r: Respuesta }[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preguntar(texto: string) {
    const pregunta = texto.trim();
    if (!pregunta || cargando) return;
    setCargando(true);
    setError(null);
    try {
      // Misma ruta relativa que el resto de la app: el proxy de Vite en desarrollo y
      // el servidor estático en producción la resuelven igual, sin configurar nada.
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pregunta }),
      });
      if (!res.ok) throw new Error(t('ask.errorServidor', { status: res.status }));
      const r = (await res.json()) as Respuesta;
      // Lo más nuevo arriba: con el hilo creciendo hacia abajo hay que perseguirlo con
      // el scroll cada vez, y lo que se acaba de preguntar es lo que se quiere leer.
      setHilo((h) => [{ pregunta, r }, ...h].slice(0, 12));
      setQ('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-(--line) bg-(--tint)">
      <div className="px-4 py-3">
        <h2 className="text-[16px] font-semibold text-(--ink-strong)">{t('ask.titulo')}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-(--ink-muted)">
          {conNodos(t('ask.intro'), { noRedacta: <strong className="text-(--ink-soft)">{t('ask.noRedacta')}</strong> })}
          {/* El analizador entiende español: en inglés se avisa, y los ejemplos siguen en español. */}
          {idioma !== 'es' && <> {t('ask.enEspanol')}</>}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void preguntar(q);
        }}
        className="flex gap-2 border-t border-(--line) px-4 py-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="cara a cara Alcaraz contra Sinner"
          aria-label={t('ask.pregunta')}
          className="min-w-0 flex-1 rounded-lg border border-(--line) bg-black/20 px-3 py-2 text-[15px] text-(--ink-strong) outline-none placeholder:text-(--ink-faint) focus:border-(--line-strong)"
        />
        <button
          type="submit"
          disabled={cargando || !q.trim()}
          className="shrink-0 rounded-lg border border-(--line-strong) px-3 py-2 text-[14px] font-medium text-(--ink-body) transition hover:bg-(--raised) disabled:opacity-40"
        >
          {cargando ? '…' : t('ask.preguntar')}
        </button>
      </form>

      {hilo.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {EJEMPLOS.map((e) => (
            <button
              key={e}
              onClick={() => void preguntar(e)}
              className="rounded-full border border-(--line) px-3 py-1 text-[13px] text-(--ink-soft) transition hover:bg-(--raised)"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="border-t border-(--line) px-4 py-3 text-[14px] text-rose-300">
          {t('ask.noPude', { error })}
        </p>
      )}

      {hilo.map((x, i) => (
        <article key={i} className="border-t border-(--line) px-4 py-3">
          <p className="text-[13px] text-(--ink-muted)">{x.pregunta}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-(--ink-strong)">{x.r.texto}</p>
          {/* Cuando se encadenaron varias consultas, se enseñan TODAS con su
              procedencia. Resumir cuatro consultas en un párrafo escondería que el Elo
              y el cara a cara pueden estar en desacuerdo, que es justo lo interesante. */}
          {x.r.pasos && x.r.pasos.length > 1 && (
            <div className="mt-2 space-y-3">
              {x.r.pasos.map((p, k) => (
                <div key={k} className="border-l-2 border-(--line) pl-3">
                  <p className="text-[14px] text-(--ink-body)">{p.respuesta.texto}</p>
                  {p.respuesta.filas && p.respuesta.filas.length > 0 && (
                    <table className="mt-1 w-full border-collapse text-[13px]">
                      <tbody>
                        {p.respuesta.filas.slice(0, 6).map((f, j) => (
                          <tr key={j}>
                            <td className="py-0.5 pr-4 text-(--ink-muted)">{f.etiqueta}</td>
                            <td className="py-0.5 text-right text-(--ink-soft)">{f.valor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="mt-1 text-[11px] text-(--ink-faint)">{t('ask.de', { fuente: p.respuesta.fuente })}</p>
                </div>
              ))}
            </div>
          )}

          {(!x.r.pasos || x.r.pasos.length <= 1) && x.r.filas && x.r.filas.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <tbody>
                  {x.r.filas.map((f, j) => (
                    <tr key={j} className="border-t border-(--line) first:border-t-0">
                      <td className="py-1.5 pr-4 text-(--ink-soft)">{f.etiqueta}</td>
                      <td className="py-1.5 text-right text-(--ink-body)">{f.valor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* La procedencia, siempre. Es lo que separa «te lo digo yo» de «míralo tú». */}
          {(!x.r.pasos || x.r.pasos.length <= 1) && (
            <p className="mt-2 text-[12px] text-(--ink-faint)">{t('ask.de', { fuente: x.r.fuente })}</p>
          )}
          {/* Quién decidió la consulta. Se dice porque cambia lo que se puede esperar de
              la siguiente pregunta, y esconderlo sería vender un determinismo que no se
              está usando. */}
          <p className="mt-1 text-[11px] text-(--ink-faint)">
            {x.r.via === 'agente'
              ? t('ask.agente', { plan: x.r.plan ?? t('ask.variasConsultas') })
              : x.r.via === 'modelo'
                ? t('ask.modelo')
                : t('ask.reglas')}
            {x.r.nota ? ` · ${x.r.nota}` : ''}
          </p>
        </article>
      ))}
    </section>
  );
}
