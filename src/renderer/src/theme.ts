import type { ThemePreference } from '../../shared/types'

// settings 表是权威值,localStorage 只是防闪烁镜像:CSP 禁内联脚本,改为
// main.tsx 里最先同步调用 bootThemeFromMirror,在 React 挂载前落 data-theme。
const MIRROR_KEY = 'devcanopy-theme'
const SETTING_KEY = 'theme'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let current: ThemePreference = 'system'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function apply(preference: ThemePreference): void {
  const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
  document.documentElement.dataset.theme = resolved
}

export function bootThemeFromMirror(): void {
  const mirrored = window.localStorage.getItem(MIRROR_KEY)
  current = isPreference(mirrored) ? mirrored : 'system'
  apply(current)
  media.addEventListener('change', () => {
    if (current === 'system') apply('system')
  })
}

// 挂载后从 settings 表校准(镜像在清缓存/换库后可能缺失或过期)。
export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await window.devcanopy.settings.get(SETTING_KEY)
  const preference = isPreference(stored) ? stored : 'system'
  applyThemePreference(preference)
  return preference
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  applyThemePreference(preference)
  await window.devcanopy.settings.set(SETTING_KEY, preference)
}

function applyThemePreference(preference: ThemePreference): void {
  current = preference
  window.localStorage.setItem(MIRROR_KEY, preference)
  apply(preference)
}
