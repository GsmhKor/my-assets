export type Theme = 'light' | 'dark' | 'custom'

export const themeDetails = {
  light: { label: '浅色', icon: 'sun', colorScheme: 'light', browserColor: '#f3f4f6' },
  dark: { label: '深色', icon: 'moon', colorScheme: 'dark', browserColor: '#111214' },
  custom: { label: '定制', icon: 'palette', colorScheme: 'dark', browserColor: '#111522' },
} as const

export function themePreference(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'custom'
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : theme === 'dark' ? 'custom' : 'light'
}
