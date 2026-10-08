/**
 * Lo generado por IA, siempre igual y siempre separado de lo calculado (§3 del
 * plan): violeta, con la etiqueta «Generado por IA», el modelo y el aviso.
 *
 * Antes había cuatro copias de este bloque (noticias, señales, informe y «Qué
 * cambió»), todas con el violeta pastel de fondo (el tono 50), que la inversión
 * de paleta de `index.css` no toca: en el tema oscuro salía una mancha blanca con el texto
 * casi invisible encima, y los botones en violeta oscuro apenas se leían (V9).
 * Ahora los colores salen de los tokens `--ai` y `--ai-bg`, y hay una sola
 * versión.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function EtiquetaIA({ children = 'Generado por IA' }: { children?: ReactNode }) {
  return (
    <span className="rounded bg-(--ai) px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ai-bg)">
      {children}
    </span>
  )
}

export function BloqueIA({
  modelo,
  nota,
  aviso,
  children,
  className = '',
}: {
  modelo: string
  /** Al lado del modelo: «desde caché (sin coste nuevo)», por ejemplo. */
  nota?: string
  aviso?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div data-contenido="ia" className={`rounded-lg border border-(--ai)/30 bg-(--ai-bg) p-3 ${className}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <EtiquetaIA />
        <span className="text-[10px] text-(--ai)">
          {modelo}
          {nota ? ` · ${nota}` : ''}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-(--text)">{children}</div>
      {aviso && <p className="mt-2 text-[10px] text-(--ai)">{aviso}</p>}
    </div>
  )
}

/** El botón que pide algo a la IA (y gasta API): con el mismo violeta, para que se vea qué cuesta. */
export function BotonIA({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg border border-(--ai)/50 px-2.5 py-1.5 text-xs font-medium text-(--ai) hover:bg-(--ai-bg) disabled:opacity-50 ${className}`}
    />
  )
}
