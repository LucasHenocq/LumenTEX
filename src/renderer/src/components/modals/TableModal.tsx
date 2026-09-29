import { useMemo, useState } from 'react'
import { insertBlock } from '../../lib/actions'
import { ModalFrame, closeModal } from '../Modals'

const MAX = 10

export default function TableModal({ matrix }: { matrix: boolean }): React.JSX.Element {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [align, setAlign] = useState<'l' | 'c' | 'r'>('c')
  const [style, setStyle] = useState<'booktabs' | 'grid' | 'none'>('booktabs')
  const [header, setHeader] = useState(true)
  const [float, setFloat] = useState(true)
  const [matrixType, setMatrixType] = useState('pmatrix')

  const code = useMemo(() => {
    let n = 0
    const cell = (r: number, c: number): string => {
      n++
      if (matrix) return `\${${String.fromCharCode(97 + ((r * cols + c) % 26))}${r + 1}${c + 1}}`
      return header && r === 0 ? `\${En-tête ${c + 1}}` : `\${${n}:}`
    }
    if (matrix) {
      const lines = Array.from({ length: rows }, (_, r) =>
        '\t' + Array.from({ length: cols }, (_, c) => cell(r, c)).join(' & ') + (r < rows - 1 ? ' \\\\' : '')
      )
      return `\\begin{${matrixType}}\n${lines.join('\n')}\n\\end{${matrixType}}`
    }
    const spec = style === 'grid' ? `|${Array(cols).fill(align).join('|')}|` : Array(cols).fill(align).join('')
    const indent = float ? '\t\t' : '\t'
    const out: string[] = []
    if (style === 'booktabs') out.push(indent + '\\toprule')
    if (style === 'grid') out.push(indent + '\\hline')
    for (let r = 0; r < rows; r++) {
      out.push(indent + Array.from({ length: cols }, (_, c) => cell(r, c)).join(' & ') + ' \\\\')
      if (style === 'grid') out.push(indent + '\\hline')
      else if (style === 'booktabs' && header && r === 0) out.push(indent + '\\midrule')
    }
    if (style === 'booktabs') out.push(indent + '\\bottomrule')
    const tabular = `${float ? '\t' : ''}\\begin{tabular}{${spec}}\n${out.join('\n')}\n${float ? '\t' : ''}\\end{tabular}`
    if (!float) return tabular
    return `\\begin{table}[htbp]\n\t\\centering\n\t\\caption{\${Légende}}\n\t\\label{tab:\${clé}}\n${tabular}\n\\end{table}`
  }, [rows, cols, align, style, header, float, matrix, matrixType])

  const preview = code.replace(/\$\{(\d+:)?([^}]*)\}/g, (_m, _n, t) => t || '…')

  const insert = (): void => {
    closeModal()
    setTimeout(() => insertBlock(code + '\n'), 10)
  }

  const [hr, hc] = hover ?? [rows - 1, cols - 1]

  return (
    <ModalFrame
      title={matrix ? 'Insérer une matrice' : 'Insérer un tableau'}
      width={640}
      footer={
        <>
          <button className="btn ghost" onClick={closeModal}>
            Annuler
          </button>
          <button className="btn primary" onClick={insert}>
            Insérer
          </button>
        </>
      }
    >
      <div className="table-wizard">
        <div>
          <div className="grid-picker" onMouseLeave={() => setHover(null)}>
            {Array.from({ length: MAX }, (_, r) =>
              Array.from({ length: MAX }, (_, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`gp-cell${r <= hr && c <= hc ? ' on' : ''}`}
                  onMouseEnter={() => setHover([r, c])}
                  onClick={() => {
                    setRows(r + 1)
                    setCols(c + 1)
                  }}
                />
              ))
            )}
          </div>
          <div className="grid-size">
            {hr + 1} × {hc + 1}
          </div>
        </div>
        <div className="tw-options">
          {matrix ? (
            <div className="tw-field">
              <label>Délimiteurs</label>
              <div className="segmented">
                {[
                  ['pmatrix', '( )'],
                  ['bmatrix', '[ ]'],
                  ['Bmatrix', '{ }'],
                  ['vmatrix', '| |'],
                  ['matrix', 'aucun']
                ].map(([v, l]) => (
                  <button key={v} className={matrixType === v ? 'on' : ''} onClick={() => setMatrixType(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="tw-field">
                <label>Alignement</label>
                <div className="segmented">
                  {(
                    [
                      ['l', 'Gauche'],
                      ['c', 'Centré'],
                      ['r', 'Droite']
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={align === v ? 'on' : ''} onClick={() => setAlign(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tw-field">
                <label>Style</label>
                <div className="segmented">
                  {(
                    [
                      ['booktabs', 'Booktabs'],
                      ['grid', 'Grille'],
                      ['none', 'Sans filets']
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={style === v ? 'on' : ''} onClick={() => setStyle(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <label className="checkbox">
                <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Ligne d’en-tête
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={float} onChange={(e) => setFloat(e.target.checked)} /> Environnement flottant avec légende
              </label>
              {style === 'booktabs' && <div className="hint">Nécessite <code>\usepackage{'{booktabs}'}</code></div>}
            </>
          )}
        </div>
      </div>
      <pre className="code-preview">{preview}</pre>
    </ModalFrame>
  )
}
