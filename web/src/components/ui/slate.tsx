// Piezas compartidas de la interfaz: slate. Partido de ui/index.tsx en la Fase 5 (ningún import cambia: index.tsx reexporta).
import { conNodos, useI18n } from '../../i18n';
import { motivoVacio } from '../../lib/vacio';

// SlateTable (la tabla «Los partidos») se quitó en el rediseño de noviembre: la lista es Partidos.

/**
 * POR QUÉ ESTA PESTAÑA ESTÁ VACÍA, CUANDO LO ESTÁ A PROPÓSITO
 * ===========================================================================
 * Con `DEMO_FIXTURES=off` la app deja de inventarse partidos, que es lo que se le ha
 * pedido. Pero una pestaña vacía se parece muchísimo a una pestaña rota: no hay forma de
 * distinguir «no hay nada que enseñar» de «no ha cargado» mirándola.
 *
 * Un vacío deliberado tiene que decir que es deliberado, y decir qué falta para que deje
 * de estarlo. Esto es lo que separa apagar la demostración —una decisión— de que la app
 * parezca averiada.
 */
export function VacioPorqueNoHayCuotas({
  reason,
  detail,
  hasKey,
  demoFixtures,
}: {
  reason: string | null | undefined;
  detail?: string | null;
  /** null mientras no se sabe (el estado de las cuotas no ha llegado o falló). */
  hasKey: boolean | null;
  demoFixtures: boolean;
}) {
  // Con la demostración encendida, un vacío significa otra cosa (no hay datos del
  // deporte) y lo explica `EmptySlate`. Esta nota es solo para el vacío deliberado.
  const { t } = useI18n();
  if (demoFixtures) return null;

  return (
    <div className="mb-6 rounded-xl border border-(--line) bg-(--tint) px-4 py-4 text-[14px] leading-relaxed text-(--ink-soft)">
      <p className="mb-2 text-[15px] font-semibold text-(--ink-strong)">
        {t('vacio.titulo')}
      </p>
      <p>
        {conNodos(t('vacio.aProposito'), { aProposito: <strong className="text-(--ink-body)">{t('vacio.aPropositoPalabra')}</strong> })}{' '}
        {t(motivoVacio(reason, hasKey))}
      </p>
      {detail && (
        <p className="mt-2 text-[13px] opacity-70">
          <span className="font-mono">{detail}</span>
        </p>
      )}
      <p className="mt-3 text-[13px] text-(--ink-muted)">
        {conNodos(t('vacio.siguenAhi'), { comando: <code>npm run demo -- --on</code> })}
      </p>
    </div>
  );
}
