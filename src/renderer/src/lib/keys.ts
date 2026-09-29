const MAC = window.api.platform === 'darwin'
const KEYS: Record<string, string> = { '↵': 'Entrée', '⇥': 'Tab' }

/**
 * Raccourcis écrits avec les symboles Mac, traduits ailleurs qu'à macOS :
 * « ⇧⌘P » → « Ctrl+Maj+P », « ⌘↵ » → « Ctrl+Entrée », « ⌥ + clic » → « Alt + clic ».
 */
export function kb(text: string): string {
  if (MAC) return text
  return text.replace(/([⌃⌥⇧⌘]*)([↵⇥]|[^\s⌃⌥⇧⌘()]*)/g, (m, mods: string, key: string) => {
    if (!mods && !KEYS[key]) return m
    const parts: string[] = []
    if (/[⌘⌃]/.test(mods)) parts.push('Ctrl')
    if (mods.includes('⌥')) parts.push('Alt')
    if (mods.includes('⇧')) parts.push('Maj')
    if (key) parts.push(KEYS[key] ?? key)
    return parts.join('+')
  })
}
