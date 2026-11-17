import type { Theme } from '../domain/theme'
import { nextTheme, themeDetails } from '../domain/theme'
import { Icon } from './Icon'

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const current = themeDetails[theme]
  const next = nextTheme(theme)
  return <button type="button" className="card settings-action" aria-label={`当前为${current.label}模式，点击切换为${themeDetails[next].label}模式`} title={`切换为${themeDetails[next].label}模式`} onClick={() => onChange(next)}><Icon name={current.icon} size={24} /><span>{current.label}</span></button>
}
