import { Link } from 'react-router';
import { useI18n } from '../i18n';

export default function NoEncontrada() {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-(--line) p-6 text-[14px] text-(--ink-soft)">
      <p className="text-[16px] font-semibold text-(--ink-strong)">{t('noEnc.titulo')}</p>
      <p className="mt-1">{t('noEnc.cuerpo')}</p>
      <Link to="/destacados" className="mt-3 inline-block text-(--ink-body) underline-offset-2 hover:underline">
        {t('noEnc.ir')}
      </Link>
    </div>
  );
}
