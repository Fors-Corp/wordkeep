import { useTheme, type ThemePreference } from '../context/ThemeContext'

const OPTIONS: Array<{ value: ThemePreference; label: string; title: string }> = [
  { value: 'light', label: 'Light', title: 'Light theme' },
  { value: 'dark', label: 'Dark', title: 'Dark theme' },
  { value: 'system', label: 'Auto', title: 'Match this device' },
]

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="inline-flex rounded-full bg-chip p-0.5 text-xs" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
          className={`rounded-full px-2.5 py-1 ${
            preference === option.value ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
