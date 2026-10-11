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
