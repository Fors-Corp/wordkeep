import { useI18n } from '../context/I18nContext'
import { useLexicon } from '../context/LexiconContext'

/** Fills an empty lexicon with linked sample words and a phrase, so there is something to try. */
export function SampleButton({ className = '' }: { className?: string }) {
  const { device } = useLexicon()
  const { t } = useI18n()
  return (
    <span className={className}>
      <button
        type="button"
        onClick={() => device?.loadSamples()}
        disabled={!device}
        className="rounded-full border border-rule bg-paper px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50"
      >
        {t('samples.load')}
      </button>
      <span className="mt-2 block text-xs text-muted">{t('samples.hint')}</span>
    </span>
  )
}
