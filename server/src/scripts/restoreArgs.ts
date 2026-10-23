// Las opciones de `npm run restore`. Aparte para poder probarlas sin ejecutar una restauración.

/** Las únicas opciones: la restauración de prueba y la confirmación de la de verdad. */
export const OPCIONES_RESTORE = ['--verificar', '--confirmar'] as const;

/**
 * Las opciones que no se conocen. Una errata (`--verify`, `--verficar`, `—verificar` con la raya
 * que pone el corrector) seguía como restauración DE VERDAD sobre el libro mayor (revisión
 * data-guardian del 20 de octubre): ahora para antes de tocar nada.
 */
export function opcionesDesconocidas(args: string[]): string[] {
  return args.filter((a) => /^(--|—|–)/.test(a) && !(OPCIONES_RESTORE as readonly string[]).includes(a));
}

/**
 * Las opciones que npm se quedó porque faltaba `--` delante (`npm run restore --verificar f.db` le
 * da al script solo «f.db» y deja npm_config_verificar). Se para: no se sabe qué se quería.
 */
export function opcionesComidasPorNpm(entorno: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string[] {
  return OPCIONES_RESTORE.filter((o) => entorno[`npm_config_${o.slice(2)}`] !== undefined);
}

/**
 * Restaurar de verdad pide `--confirmar` explícito. Si npm se lo come (sin `--`), no llega, y el
 * script no restaura: el error es hacia el lado seguro.
 */
export function restauracionConfirmada(args: string[]): boolean {
  return args.includes('--confirmar');
}
