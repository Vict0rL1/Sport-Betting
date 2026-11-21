// D1 (revisión del PR 17): el historial de una estimación dice de dónde partió, dónde está, cuánto
// se movió (en puntos porcentuales, por resultado), qué versiones intervinieron y cuál se puntúa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirHistorial, type EntradaHistorial } from './historial.ts';

const e = (id: number, probs: number[], v: string | null, papel: EntradaHistorial['papel'] = 'revision', en = `2026-11-20T0${id}:00:00Z`): EntradaHistorial => ({ id, captured_at: en, outcomes: ['Local', 'Empate', 'Visitante'], probs, model_version: v, papel });

test('D1: original, última, Δpp por resultado y Δ entre filas consecutivas', () => {
  const r = resumirHistorial([e(1, [0.2, 0.2, 0.6], 'v1', 'original'), e(2, [0.35, 0.25, 0.4], 'v1'), e(3, [0.6, 0.2, 0.2], 'v2', 'evaluada')])!;
  assert.equal(r.original.id, 1);
  assert.equal(r.ultima.id, 3);
  assert.deepEqual(r.deltaPp.map((x) => +x.toFixed(6)), [40, 0, -40]);
  assert.deepEqual(r.filas.map((f) => f.deltaPp?.map((x) => +x.toFixed(6)) ?? null), [null, [15, 5, -20], [25, -5, -20]]);
  assert.deepEqual(r.versiones, ['v1', 'v2']);
  assert.deepEqual(r.filas.map((f) => f.cambioDeVersion), [false, false, true]);
  assert.equal(r.evaluada?.id, 3);
  assert.equal(r.favoritoCambia, true);
});

test('D1: una sola estimación: original y última son la misma, sin Δ; versión desconocida no se inventa', () => {
  const r = resumirHistorial([e(1, [0.5, 0.3, 0.2], null, 'original')])!;
  assert.equal(r.original, r.ultima);
  assert.deepEqual(r.deltaPp, [0, 0, 0]);
  assert.deepEqual(r.versiones, [null]);
  assert.equal(r.evaluada, null);
  assert.equal(r.favoritoCambia, false);
});

test('D1: filas con otro número de resultados no se comparan (Δ desconocido, no inventado)', () => {
  const rara = { ...e(2, [0.5, 0.5], 'v1'), outcomes: ['Local', 'Visitante'] };
  const r = resumirHistorial([e(1, [0.2, 0.2, 0.6], 'v1', 'original'), rara])!;
  assert.equal(r.filas[1].deltaPp, null);
  assert.equal(r.deltaPp, null);
  assert.equal(resumirHistorial([]), null);
});
