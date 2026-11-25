// Estados de carga reutilizables (fase C de la revisión del PR 17). Una petición que falla no es
// una lista vacía ni un «Cargando…» eterno: se dice, con un «Reintentar». Y un refresco que falla
// deja lo último bueno a la vista, con un aviso.
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { useI18n } from '../../i18n';
import { REMOTO_INICIAL, alFallar, alPedir, alRecibir, ErrorDeCarga, type Remoto } from '../../lib/remoto';

/** Carga `cargar()` con un estado que no miente; `recargar` la repite. Solo escribe la última. */
export function useCarga<T>(cargar: () => Promise<T>, deps: DependencyList): { estado: Remoto<T>; recargar: () => void } {
  const [estado, setEstado] = useState<Remoto<T>>(REMOTO_INICIAL);
  const turno = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pedir = useCallback(cargar, deps);
  const recargar = useCallback(() => {
    const n = ++turno.current;
    setEstado((e) => alPedir(e));
    pedir()
      .then((d) => n === turno.current && setEstado((e) => alRecibir(e, d, Date.now())))
      .catch((e: unknown) => n === turno.current && setEstado((x) => alFallar(x, e instanceof ErrorDeCarga ? e.status : 0)));
  }, [pedir]);
  useEffect(recargar, [recargar]);
  return { estado, recargar };
}

/** «No se pudo cargar … · Reintentar», anunciado (role="alert"). */
export function FalloCarga({ que, onReintentar }: { que: string; onReintentar: () => void }) {
  const { t } = useI18n();
  return (
    <p role="alert" className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-(--line-strong) px-3 py-2 text-[13px] text-(--status-critical)">
      <span>{t('carga.fallo', { que })}</span>
      <button type="button" onClick={onReintentar} className="toque underline underline-offset-2 [--toque-y:6px]">{t('carga.reintentar')}</button>
    </p>
  );
}

/** Tras un refresco fallido: se siguen viendo los datos de antes, y se dice. */
export function AvisoRefresco({ que, onReintentar }: { que: string; onReintentar: () => void }) {
  const { t } = useI18n();
  return (
    <p role="alert" className="mb-2 text-[12px] text-(--status-warning)">
      {t('carga.falloRefresco', { que })}{' '}
      <button type="button" onClick={onReintentar} className="toque underline underline-offset-2 [--toque-y:6px]">{t('carga.reintentar')}</button>
    </p>
  );
}
