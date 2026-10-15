import { useI18n } from '../context/I18nContext'
import { useTheme, type ThemePreference } from '../context/ThemeContext'
import type { MessageKey } from '../i18n'

const OPTIONS: Array<{ value: ThemePreference; label: MessageKey; title: MessageKey }> = [
  { value: 'light', label: 'theme.light', title: 'theme.lightTitle' },
  { value: 'dark', label: 'theme.dark', title: 'theme.darkTitle' },
  { value: 'system', label: 'theme.auto', title: 'theme.autoTitle' },
]

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme()
  const { t } = useI18n()
  return (
    <div className="inline-flex rounded-full bg-chip p-0.5 text-xs" role="group" aria-label={t('theme.label')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={t(option.title)}
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
          className={`rounded-full px-2.5 py-1 ${
            preference === option.value ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
          }`}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  )
}
