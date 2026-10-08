// Galería de componentes (Fase 5.27): las piezas con datos de EJEMPLO fijos, para que las
// capturas de Playwright no dependan de qué partidos hay hoy. Apagada por defecto
// (interfaz.muestras) y etiquetada en grande: nada de esto es una predicción.

import { useEffect, useState } from 'react';
import { ConfianzaBadge } from '../components/trust/ConfianzaBadge';
import { Tarjeta } from '../components/picks/Tarjeta';
import type { Pick } from '../components/picks/tipos';
import NoEncontrada from './NoEncontrada';
import { useI18n } from '../i18n';

const EJEMPLO: Pick = {
  deporte: 'Fútbol', sport: 'football', matchKey: 'muestra-1', eventoId: 'muestra-1', liga: 'ejemplo', cuando: '2030-01-05T15:00:00.000Z', partido: 'Equipo Local vs Equipo Visitante',
  casa: 'Equipo Local', fuera: 'Equipo Visitante', casaId: null, fueraId: null,
  opciones: [{ nombre: 'Equipo Local', p: 0.52, cuota: 2.05 }, { nombre: 'Empate', p: 0.26, cuota: 3.5 }, { nombre: 'Equipo Visitante', p: 0.22, cuota: 3.9 }],
  favorito: 'Equipo Local', probabilidad: 0.52, cuota: 2.05, cuotaJusta: 1 / 0.52, ventaja: 0.52 * 2.05 - 1, casas: 6, fiabilidad: 'medium',
  confianza: { nivel: 'MEDIA', calidadDatos: 82, estabilidad: 'ALTA', desacuerdo: 'BAJO', incertidumbrePp: 3.1, decision: 'NO BET', motivo: 'ejemplo: ventaja por debajo del mínimo', evaluadaEn: '2030-01-04T10:00:00.000Z' },
  historico: { franja: '50–60 %', acierto: 0.55, n: 1234 },
};

export default function Muestras() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/features').then((r) => r.json()).then((j: { features: Record<string, { on: boolean }> }) => setOn(!!j.features['interfaz.muestras']?.on)).catch(() => setOn(false));
  }, []);
  if (on === null) return null;
  if (!on) return <NoEncontrada />;
  return (
    <div>
      <p role="note" className="mb-4 rounded-lg border-2 border-[#c98500] px-3 py-2 text-[14px] font-semibold text-(--ink-strong)">
        {t('muestras.aviso')}
      </p>
      <section className="mb-6" data-testid="muestra-insignias">
        <h2 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('muestras.insignia')}</h2>
        <div className="flex flex-wrap gap-3">
          <ConfianzaBadge nivel="ALTA" decision="BET" />
          <ConfianzaBadge nivel="MEDIA" decision="NO BET" />
          <ConfianzaBadge nivel="BAJA" decision="NO BET" />
          <ConfianzaBadge nivel="MEDIA" decision="SIN MERCADO" />
          <ConfianzaBadge nivel={null} decision={null} />
        </div>
      </section>
      <section className="max-w-xl" data-testid="muestra-tarjeta">
        <h2 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{t('muestras.tarjeta')}</h2>
        <Tarjeta p={EJEMPLO} puesto={1} elegido={false} onElegir={() => undefined} />
      </section>
    </div>
  );
}
