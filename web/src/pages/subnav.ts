// Las subpáginas de Apuestas y Confianza (Fase 6), en un sitio: la pestaña y sus páginas.
import { useI18n } from '../i18n';
import { RUTA_LABORATORIO, RUTA_LINEAS, RUTA_ARCHIVO, RUTA_DIAGNOSTICO } from '../rutas';

export function useSubnavApuestas(): { ruta: string; texto: string }[] {
  const { t } = useI18n();
  return [
    { ruta: '/apuestas', texto: t('nav.registro') },
    { ruta: RUTA_LABORATORIO, texto: t('nav.laboratorio') },
    { ruta: RUTA_LINEAS, texto: t('nav.lineas') },
  ];
}

export function useSubnavConfianza(): { ruta: string; texto: string }[] {
  const { t } = useI18n();
  return [
    { ruta: '/confianza', texto: t('nav.resumenConfianza') },
    { ruta: RUTA_ARCHIVO, texto: t('nav.archivo') },
    { ruta: RUTA_DIAGNOSTICO, texto: t('nav.diagnostico') },
  ];
}
