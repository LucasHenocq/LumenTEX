import { AlertCircle, AlertTriangle, Copy, Info, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Diagnostic } from '../../../shared/types'
import { textOf } from '../editor/setup'
import { openFile } from '../lib/actions'
import { emit } from '../lib/bus'
import { contents } from '../lib/projectIndex'
import { store, toast, useApp } from '../store'
import { kb } from '../lib/keys'

const ICON = { error: AlertCircle, warning: AlertTriangle, info: Info }

function explain(d: Diagnostic): string | null {
  const m = d.message
  if (/Undefined control sequence/i.test(m)) return 'Commande inconnue : faute de frappe, ou paquet manquant (\\usepackage).'
  if (/Missing \$ inserted/i.test(m)) return 'Symbole mathématique utilisé hors du mode maths : entourez-le de $…$.'
  if (/File `(.+)' not found/i.test(m)) return 'Fichier introuvable : vérifiez le nom et le chemin (relatif au fichier principal).'
  if (/Environment (.+) undefined/i.test(m)) return 'Environnement inconnu : paquet manquant ou faute de frappe.'
  if (/Missing \} inserted|Extra \}|Too many \}'s/i.test(m)) return 'Accolades déséquilibrées.'
  if (/Extra alignment tab/i.test(m)) return 'Trop de « & » dans une ligne de tableau par rapport au nombre de colonnes.'
  if (/Misplaced alignment tab/i.test(m)) return '« & » utilisé hors d’un tableau : écrivez \\& pour afficher le caractère.'
  if (/There's no line here to end/i.test(m)) return '« \\\\ » utilisé là où aucune ligne n’est à terminer (ex. après une ligne vide).'
  if (/^Reference .* undefined/i.test(m)) return 'Étiquette introuvable : vérifiez le \\label correspondant.'
  if (/^Citation .* undefined/i.test(m)) return 'Clé de bibliographie introuvable dans le fichier .bib.'
  if (/Overfull \\hbox/i.test(m)) return 'Ligne trop longue qui déborde dans la marge.'
  if (/Underfull \\hbox/i.test(m)) return 'Ligne trop peu remplie (espacement étiré).'
  if (/Paragraph ended before/i.test(m)) return 'Argument non fermé avant une ligne vide : accolade manquante ?'
  if (/Missing \\begin\{document\}/i.test(m)) return 'Du texte se trouve avant \\begin{document}.'
  if (/\\begin\{(.+)\} on input line \d+ ended by \\end/i.test(m)) return 'Les \\begin et \\end ne correspondent pas.'
  return null
}

function aiPrompt(d: Diagnostic): string {
  const lines = d.file ? (textOf(d.file) ?? contents.get(d.file) ?? '').split('\n') : []
  const from = Math.max(0, (d.line ?? 1) - 11)
  const excerpt = lines
    .slice(from, from + 21)
    .map((l, i) => `${from + i + 1}${from + i + 1 === d.line ? ' >' : '  '} ${l}`)
    .join('\n')
  return [
    'Explique brièvement cette erreur de compilation : cause probable, puis la ligne corrigée (sans modifier le fichier).',
    '',
    `Erreur : ${d.message}`,
    d.context ? `Contexte TeX : ${d.context}` : '',
    `Fichier : ${d.file ?? d.rawFile ?? '?'}${d.line ? `, ligne ${d.line}` : ''}`,
    excerpt ? `\nExtrait (la ligne en cause est marquée >) :\n${excerpt}` : ''
  ].join('\n')
}

export default function LogPanel(): React.JSX.Element {
  const diagnostics = useApp((s) => s.diagnostics)
  const result = useApp((s) => s.result)
  const [tab, setTab] = useState<'problems' | 'log' | 'output'>('problems')
  const [filters, setFilters] = useState({ error: true, warning: true, info: false })

  const counts = useMemo(
    () => ({
      error: diagnostics.filter((d) => d.severity === 'error').length,
      warning: diagnostics.filter((d) => d.severity === 'warning').length,
      info: diagnostics.filter((d) => d.severity === 'info').length
    }),
    [diagnostics]
  )
  const shown = diagnostics.filter((d) => filters[d.severity])

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text)
    toast('Copié dans le presse-papiers', 'success')
  }

  return (
    <div className="log-panel">
      <div className="log-header">
        <div className="segmented">
          <button className={tab === 'problems' ? 'on' : ''} onClick={() => setTab('problems')}>
            Problèmes <span className="seg-count">{counts.error + counts.warning}</span>
          </button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
            Journal
          </button>
          <button className={tab === 'output' ? 'on' : ''} onClick={() => setTab('output')}>
            Sortie
          </button>
        </div>
        {tab === 'problems' && (
          <div className="log-filters">
            {(['error', 'warning', 'info'] as const).map((k) => {
              const I = ICON[k]
              return (
                <button key={k} className={`chip ${k}${filters[k] ? ' on' : ''}`} onClick={() => setFilters({ ...filters, [k]: !filters[k] })}>
                  <I size={12} /> {k === 'error' ? 'Erreurs' : k === 'warning' ? 'Avertissements' : 'Infos'} {counts[k]}
                </button>
              )
            })}
          </div>
        )}
        <div className="log-actions">
          {tab !== 'problems' && (
            <button className="icon-btn subtle" title="Copier" onClick={() => copy(tab === 'log' ? (result?.log ?? '') : (result?.output ?? ''))}>
              <Copy size={14} />
            </button>
          )}
          <button className="icon-btn subtle" title={kb('Fermer (⌘J)')} onClick={() => store.set({ logOpen: false })}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="log-body">
        {tab === 'problems' &&
          (shown.length ? (
            shown.map((d, i) => {
              const I = ICON[d.severity]
              const hint = explain(d)
              return (
                <div
                  key={i}
                  className={`diag ${d.severity}${d.file && d.line ? ' clickable' : ''}`}
                  onClick={() => d.file && void openFile(d.file, { line: d.line })}
                >
                  <I size={14} className="diag-icon" />
                  <div className="diag-main">
                    <div className="diag-msg">{d.message}</div>
                    {d.context && <code className="diag-ctx">{d.context}</code>}
                    {hint && <div className="diag-hint">{hint}</div>}
                  </div>
                  {d.severity !== 'info' && (
                    <button
                      className="icon-btn subtle"
                      title="Demander à l’assistant IA"
                      onClick={(e) => {
                        e.stopPropagation()
                        emit('copilot:ask', aiPrompt(d))
                      }}
                    >
                      <Sparkles size={14} />
                    </button>
                  )}
                  <div className="diag-loc">
                    {(d.file ?? d.rawFile) && (
                      <>
                        {d.file ?? d.rawFile}
                        {d.line ? `:${d.line}` : ''}
                      </>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="log-empty">{result ? 'Aucun problème 🎉' : 'Aucune compilation pour le moment.'}</div>
          ))}
        {tab === 'log' && <pre className="raw-log">{result?.log || 'Pas de journal.'}</pre>}
        {tab === 'output' && <pre className="raw-log">{result?.output || 'Pas de sortie.'}</pre>}
      </div>
    </div>
  )
}
