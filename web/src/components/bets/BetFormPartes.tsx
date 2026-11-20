import { resultadoApuesta, validarCuota, validarImporte } from '../../lib/mercado';
// Piezas de BetForm.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { PROFIT_TEXT } from '../../lib/theme';
import { useI18n } from '../../i18n';
import { money } from '../../lib/bets';

/**
 * Lo que pagaría si gana, con la apuesta (bruto) y el neto, y lo que perdería: con la aritmética
 * única de lib/mercado (céntimos exactos). Solo con una cuota y una cantidad válidas; con un borrador
 * vacío o a medias no se enseña nada (no es una apuesta registrada).
 */
export function Payout({ odds, stake, moneda }: { odds: string; stake: string; moneda: string | null }) {
  const { t } = useI18n();
  const o = validarCuota(odds);
  const s = validarImporte(stake);
  if (!o.ok || !s.ok) return <div className="hidden sm:block" />;
  const r = resultadoApuesta(s.valor, o.valor, 'won');
  if (!r) return <div className="hidden sm:block" />;
  const m = moneda ? ` ${moneda}` : '';
  return (
    <div className="flex flex-col justify-end gap-0.5 pb-1 text-[14px] text-(--ink-soft) sm:col-span-1">
      <span>
        {t('form.pagoSiGana')}{' '}
        <strong className="font-semibold tabular-nums text-(--ink-strong)">{money(r.pago)}{m}</strong>
      </span>
      <span>
        {t('form.netoSiGana')}{' '}
        <strong className="font-semibold tabular-nums" style={{ color: PROFIT_TEXT }}>+{money(r.neto)}{m}</strong>
        {' · '}{t('form.siPierde')} <span className="tabular-nums">−{money(s.valor)}{m}</span>
      </span>
    </div>
  );
}

export function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-[14px] font-medium ring-1 ring-inset transition ${
        active ? 'bg-(--raised-3) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line)'
      }`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">
        {label}
      </span>
      {children}
      {/* The server's own message, under the field it names — not one generic
          "revisa el formulario" that leaves you hunting. */}
      {error && <span className="mt-1 block text-[13px] text-[#d95926]">{error}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg bg-(--raised) px-3 py-2 text-[16px] text-(--ink-strong) ring-1 ring-inset ring-(--line) placeholder:text-(--ink-faint) focus:outline-none focus:ring-(--line-strong)';
export const selectClass = `${inputClass} appearance-none`;

export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
