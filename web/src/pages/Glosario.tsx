import { GLOSARIO, terminoEn } from '../lib/glosario';
import { useI18n } from '../i18n';

export default function Glosario() {
  const { t, idioma } = useI18n();
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-semibold text-(--ink-strong)">{t('glosario.titulo')}</h2>
      <p className="mb-4 text-[13px] text-(--ink-muted)">{t('glosario.intro')}</p>
      <dl className="space-y-3">
        {GLOSARIO.map((t0) => terminoEn(t0, idioma)).map((x) => (
          <div key={x.clave} id={x.clave} className="rounded-xl border border-(--line) p-4">
            <dt className="text-[15px] font-semibold text-(--ink-strong)">{x.nombre}</dt>
            <dd className="mt-0.5 text-[13px] text-(--ink-body)">{x.corta}</dd>
            <dd className="mt-1 text-[13px] leading-relaxed text-(--ink-soft)">{x.larga}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
