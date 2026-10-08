/**
 * «parcial: falta deuda a corto», bajo una deuda neta que cuenta como cero una
 * partida que el filing no trae (Ronda 2). Una sola versión para Salud y para
 * el informe: antes el informe no lo decía y su lectura llegaba a afirmar «Sin
 * datos de endeudamiento» con la deuda neta al lado (V11).
 */
const NOMBRES: Record<string, string> = { short_term_debt: 'deuda a corto', long_term_debt: 'deuda a largo' }

export function DeudaParcial({ falta }: { falta: string[] | null | undefined }) {
  if (!falta || falta.length === 0) return null
  return (
    <dd
      className="text-[11px] text-amber-800"
      title="El filing no trae una de las partidas de deuda: cuenta como cero. Si existe, la deuda neta real es mayor."
    >
      parcial: falta {falta.map((c) => NOMBRES[c] ?? c).join(' y ')}
    </dd>
  )
}
