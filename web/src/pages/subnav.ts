// Las subpáginas de Apuestas y Confianza (Fase 6), en un sitio: la pestaña y sus páginas.
import { useI18n } from '../i18n';
import { RUTA_LABORATORIO } from '../rutas';

export function useSubnavApuestas(): { ruta: string; texto: string }[] {
  const { t } = useI18n();
  return [
    { ruta: '/apuestas', texto: t('nav.registro') },
    { ruta: RUTA_LABORATORIO, texto: t('nav.laboratorio') },
  ];
}
