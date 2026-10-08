// Avisos de muestra: cuándo una cifra todavía no permite concluir nada.
//
// Son AVISOS, no una prueba estadística: el veredicto de verdad lo da el intervalo de
// validation.ts. Esto existe para que ningún «ROI +18 %» con 11 apuestas se lea sin una
// advertencia al lado. Los umbrales son orientativos y están escritos por qué:
//
//   apuestas (ROI, CLV)   con cuotas ~2,0, el ROI de n apuestas tiene un error típico de
//                         ~100/√n puntos: con 30 son ±18, con 300 todavía ±6.
//   predicciones          el log loss de n partidos se mueve ~0,5/√n: con 100, ±0,05, que
//                         es más que la distancia entre un buen modelo y uno malo.

export type TipoMuestra = 'apuestas' | 'predicciones';

export const UMBRALES_MUESTRA: Record<TipoMuestra, { insuficiente: number; orientativa: number }> = {
  apuestas: { insuficiente: 30, orientativa: 300 },
  predicciones: { insuficiente: 100, orientativa: 500 },
};

export interface AvisoMuestra {
  nivel: 'insuficiente' | 'orientativa' | 'suficiente';
  texto: string | null;
}

export function avisoMuestra(n: number, tipo: TipoMuestra): AvisoMuestra {
  const u = UMBRALES_MUESTRA[tipo];
  if (n < u.insuficiente) {
    return { nivel: 'insuficiente', texto: `⚠ ${n} ${tipo}: muestra demasiado pequeña para sacar conclusiones (aviso a partir de ${u.insuficiente}).` };
  }
  if (n < u.orientativa) {
    return { nivel: 'orientativa', texto: `⚠ ${n} ${tipo}: cifra orientativa; el azar todavía la mueve mucho (menos de ${u.orientativa}).` };
  }
  return { nivel: 'suficiente', texto: null };
}
