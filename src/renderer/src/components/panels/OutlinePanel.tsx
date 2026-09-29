import { Bookmark, Hash, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildOutline, documentFiles } from '../../latex/analysis'
import { openFile } from '../../lib/actions'
import { contents, index } from '../../lib/projectIndex'
import { useApp } from '../../store'

const KIND_LABEL: Record<string, string> = {
  part: 'Partie',
  chapter: 'Chapitre',
  section: 'Section',
  subsection: 'Sous-section',
  subsubsection: 'Sous-sous-section',
  paragraph: 'Paragraphe',
  subparagraph: 'Sous-paragraphe',
  frametitle: 'Diapositive'
}

export default function OutlinePanel(): React.JSX.Element {
  const mainFile = useApp((s) => s.mainFile)
  const active = useApp((s) => s.active)
  const line = useApp((s) => s.cursor.line)
  const version = useApp((s) => s.indexVersion)
  const [tab, setTab] = useState<'outline' | 'labels'>('outline')

  const items = useMemo(() => {
    void version
    if (!mainFile) return []
    return buildOutline(mainFile, contents)
  }, [mainFile, version])

  const docFiles = useMemo(() => {
    void version
    return mainFile ? new Set(documentFiles(mainFile, contents)) : new Set<string>()
  }, [mainFile, version])

  const labels = useMemo(() => {
    void version
    return index.labels.filter((l) => docFiles.has(l.file)).sort((a, b) => a.name.localeCompare(b.name))
  }, [version, docFiles])

  // Section courante : dernière entrée du fichier actif située avant le curseur
  const currentIdx = useMemo(() => {
    let idx = -1
    items.forEach((it, i) => {
      if (it.file === active && it.line <= line) idx = i
    })
    return idx
  }, [items, active, line])

  const minLevel = items.length ? Math.min(...items.map((i) => i.level)) : 0

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="segmented">
          <button className={tab === 'outline' ? 'on' : ''} onClick={() => setTab('outline')}>
            Plan
          </button>
          <button className={tab === 'labels' ? 'on' : ''} onClick={() => setTab('labels')}>
            Étiquettes <span className="seg-count">{labels.length}</span>
          </button>
        </div>
      </div>
      <div className="panel-body">
        {tab === 'outline' &&
          (items.length ? (
            items.map((it, i) => (
              <div
                key={`${it.file}:${it.line}:${i}`}
                className={`outline-row lvl-${it.level - minLevel}${i === currentIdx ? ' current' : ''}`}
                style={{ paddingLeft: 12 + (it.level - minLevel) * 14 }}
                onClick={() => void openFile(it.file, { line: it.line })}
                title={`${KIND_LABEL[it.kind] ?? it.kind} — ${it.file}:${it.line}`}
              >
                {it.level - minLevel === 0 ? <Bookmark size={13} /> : <Hash size={12} />}
                <span className="outline-title">{it.title}</span>
                {it.file !== mainFile && <span className="outline-file">{it.file.split('/').pop()}</span>}
              </div>
            ))
          ) : (
            <div className="panel-empty">
              Aucune section trouvée.
              <br />
              Utilisez <code>\section{'{…}'}</code> pour structurer votre document.
            </div>
          ))}
        {tab === 'labels' &&
          (labels.length ? (
            labels.map((l) => (
              <div key={`${l.file}:${l.line}:${l.name}`} className="label-row" onClick={() => void openFile(l.file, { line: l.line })} title={`${l.file}:${l.line}`}>
                <Tag size={12} />
                <div className="label-text">
                  <span className="label-name">{l.name}</span>
                  <span className="label-ctx">{l.context}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="panel-empty">Aucune étiquette \label.</div>
          ))}
      </div>
    </div>
  )
}
