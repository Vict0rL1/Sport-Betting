// G15 (segunda pasada de ui-tester al lote G): la bandeja enseñaba el código del aviso tal cual
// («cambio prediccion», sin tilde y con el guion bajo cambiado por un espacio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tr, tipoDeAviso } from './index';

const t = (c: Parameters<typeof tr>[1], v?: Record<string, string | number>) => tr('es', c, v);
// Los tipos que crea el servidor: alerts/detectors.ts y las llamadas a notificar().
const TIPOS = ['abridor_cambiado', 'alineacion_confirmada', 'calidad_datos_baja', 'cambio_prediccion', 'cuotas_viejas', 'deriva', 'edge_umbral', 'mercado_movido', 'qb_cambiado', 'digest_listo', 'informe_semanal', 'papel_apostada', 'papel_liquidada', 'senal_valor', 'trabajo_fallido'];

test('G15: cada tipo de aviso tiene nombre en el catálogo; uno desconocido sale legible, nunca con guiones bajos', () => {
  assert.equal(tipoDeAviso(t, 'cambio_prediccion'), 'Cambio de predicción');
  for (const tipo of TIPOS) assert.notEqual(tipoDeAviso(t, tipo), tipo.replace(/_/g, ' '), `${tipo} sin entrada`);
  assert.equal(tipoDeAviso(t, 'algo_nuevo'), 'algo nuevo');
});
