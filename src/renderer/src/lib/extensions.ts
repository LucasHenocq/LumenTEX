import type { ExtensionInfo } from '../../../shared/types'
import { store } from '../store'

/** Extensions installées et compatibles avec cette version de Lumen TeX */
export const extensions = (): ExtensionInfo[] => {
  const off = store.get().settings.extDisabled ?? []
  return store.get().extensions.filter((e) => e.compatible && !off.includes(e.id))
}

export async function loadExtensions(): Promise<void> {
  store.set({ extensions: await window.api.extList() })
}

/** Clé d'un thème dans les réglages : « id de l'extension/nom du thème » */
export const themeKey = (ext: ExtensionInfo, name: string): string => `${ext.id}/${name}`

/** Thème de couleurs d'une extension : ses variables CSS remplacent celles de l'app (clair et/ou sombre) */
export function applyColorTheme(key: string): void {
  let el = document.getElementById('ext-theme')
  if (!el) {
    el = document.createElement('style')
    el.id = 'ext-theme'
    document.head.appendChild(el)
  }
  const theme = extensions()
    .flatMap((e) => e.themes.map((t) => ({ ...t, key: themeKey(e, t.name) })))
    .find((t) => t.key === key)
  const block = (mode: string, vars: Record<string, string>): string =>
    Object.keys(vars).length
      ? `:root:root[data-theme='${mode}'] {\n${Object.entries(vars)
          .map(([k, v]) => `  ${k}: ${v};`)
          .join('\n')}\n}\n`
      : ''
  el.textContent = theme ? block('light', theme.light) + block('dark', theme.dark) : ''
}
