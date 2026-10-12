// Preuve vérifiée étape par étape : chaque étape de la preuve LaTeX est une étape Lean annoncée par un commentaire
//   -- Étape 2 : « donc p est pair »
//   have etape2 : Even p := by …
// Une étape que l'IA juge fausse ou ne sait pas justifier est marquée (et laissée en sorry) :
//   -- ÉTAPE FAUSSE : pour n = 40, n² + n + 41 = 41²

export interface LeanStep {
  n: number
  /** Phrase de la preuve LaTeX */
  quote: string
  /** Affirmation Lean de l'étape (après « have nom : ») */
  claim: string
  /** Problème signalé par l'IA (étape fausse ou non justifiée), ou laissée en sorry */
  problem: string | null
  /** Lean conclut sans cette étape : la preuve Lean a pris un autre chemin que la preuve LaTeX */
  unused?: boolean
}

/**
 * Variantes du théorème, chacune privée d'une étape (« clear etapeK » juste avant l'étape suivante). Une variante que
 * Lean accepte prouve que l'étape ne sert pas. lines : plage de lignes (à partir de 1) de chaque variante dans text
 */
export function withoutSteps(code: string, name: string, steps: LeanStep[]): { text: string; variants: { n: number; from: number; to: number }[] } | null {
  const lines = code.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*theorem\\s+${name}\\b`).test(l))
  if (start < 0) return null
  const head = lines.slice(0, start)
  const theorem = lines.slice(start)
  const indentOf = (l: string): number => /^[\s·.]*/.exec(l)![0].length
  const out = [...head]
  const variants: { n: number; from: number; to: number }[] = []
  const last = Math.max(...steps.map((s) => s.n))
  for (const s of steps) {
    // La dernière étape est la conclusion ; une étape sans « have etapeK » ne peut pas être retirée
    const h = theorem.findIndex((l) => new RegExp(`\\bhave\\s+etape${s.n}\\b`).test(l))
    if (s.n === last || h < 0) continue
    // Juste après le bloc du have (première ligne non vide moins indentée ou au même niveau) : avant tout usage
    const indent = indentOf(theorem[h])
    let at = h + 1
    while (at < theorem.length && (!theorem[at].trim() || indentOf(theorem[at]) > indent)) at++
    if (at >= theorem.length) continue
    const variant = [...theorem.slice(0, at), `${' '.repeat(indent)}clear etape${s.n}`, ...theorem.slice(at)]
    variant[0] = variant[0].replace(new RegExp(`\\btheorem\\s+${name}\\b`), `theorem ${name}_sans_etape${s.n}`)
    out.push('')
    variants.push({ n: s.n, from: out.length + 1, to: out.length + variant.length })
    out.push(...variant)
  }
  return variants.length ? { text: out.join('\n'), variants } : null
}

// Éventuellement derrière la puce d'un cas (« · -- Étape 1 : … »)
const STEP = /^[\s·.]*--\s*[ÉE]tape\s+(\d+)\s*:\s*(.*)$/i
const FLAG = /^\s*--\s*[ÉE]TAPE\s+(FAUSSE|NON\s+JUSTIFI[ÉE]E)\s*:?\s*(.*)$/i

export function parseSteps(code: string): LeanStep[] {
  const lines = code.split('\n')
  const steps: LeanStep[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = STEP.exec(lines[i])
    if (!m) continue
    // Bloc de l'étape : jusqu'à l'étape suivante (ou la fin)
    let j = i + 1
    while (j < lines.length && !STEP.exec(lines[j])) j++
    const block = lines.slice(i + 1, j)
    const body = block.join('\n')
    const flag = block.map((l) => FLAG.exec(l)).find(Boolean)
    // Affirmation du have, sinon première ligne de Lean (définition « set P := … », cas, calcul…)
    const firstLine = block.map((l) => l.replace(/^[\s·.]+/, '')).find((l) => l && !l.startsWith('--')) ?? ''
    const claim = (/\bhave\s+[^:\s]*\s*:\s*([\s\S]*?)\s*:=/.exec(body)?.[1] ?? firstLine).replace(/\s+/g, ' ').trim()
    steps.push({
      n: Number(m[1]),
      quote: m[2].trim().replace(/^«\s*|\s*»$/g, ''),
      claim,
      problem: flag
        ? `${/FAUSSE/i.test(flag[1]) ? 'Étape fausse' : 'Étape non justifiée'}${flag[2] ? ` : ${flag[2].trim()}` : ''}`
        : /\bsorry\b/.test(body)
          ? 'Étape laissée sans justification (sorry)'
          : null
    })
    i = j - 1
  }
  // Une étape peut en contenir d’autres (raisonnement par l’absurde) : affichées dans l’ordre de la preuve LaTeX
  return steps.sort((a, b) => a.n - b.n)
}
