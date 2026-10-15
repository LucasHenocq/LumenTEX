// Différences ligne à ligne entre deux textes (algorithme de Myers, le même principe que git diff), regroupées en
// blocs avec quelques lignes de contexte autour de chaque changement.

export interface DiffLine {
  type: 'same' | 'del' | 'add'
  text: string
  /** Numéro de ligne dans l'ancien texte (same, del) et dans le nouveau (same, add) */
  a?: number
  b?: number
}

/** Au-delà, la comparaison détaillée serait trop longue : tout l'ancien texte retiré, tout le nouveau ajouté */
const MAX_EDITS = 4000

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  const max = n + m
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= Math.min(max, MAX_EDITS) && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const i = k + max
      let x = k === -d || (k !== d && v[i - 1] < v[i + 1]) ? v[i + 1] : v[i - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[i] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  if (!found)
    return [...a.map((text, i): DiffLine => ({ type: 'del', text, a: i + 1 })), ...b.map((text, j): DiffLine => ({ type: 'add', text, b: j + 1 }))]
  // Remontée du chemin, de la fin au début
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d]
    const k = x - y
    const i = k + max
    const prevK = k === -d || (k !== d && vd[i - 1] < vd[i + 1]) ? k + 1 : k - 1
    const prevX = vd[prevK + max]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ type: 'same', text: a[x - 1], a: x, b: y })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) out.push({ type: 'add', text: b[y - 1], b: y })
      else out.push({ type: 'del', text: a[x - 1], a: x })
    }
    x = prevX
    y = prevY
  }
  return out.reverse()
}

/** Blocs de changements, avec `context` lignes inchangées autour ; null entre deux blocs éloignés */
export function hunks(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Array(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.type === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true
  })
  const out: (DiffLine | null)[] = []
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l)
    else if (out.length && out[out.length - 1] !== null) out.push(null)
  })
  if (out[out.length - 1] === null) out.pop()
  return out
}
