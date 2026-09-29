import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TEMPLATES } from '../../latex/templates'
import { createProject } from '../../lib/actions'
import { ModalFrame, closeModal } from '../Modals'

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'projet'
  )
}

function TemplateThumb({ id, accent }: { id: string; accent: string }): React.JSX.Element {
  // Miniature stylisée de la mise en page du modèle
  const lines = (n: number, y: number, w = 44): React.JSX.Element[] =>
    Array.from({ length: n }, (_, i) => <rect key={`${y}-${i}`} x="10" y={y + i * 5} width={i === n - 1 ? w * 0.6 : w} height="2" rx="1" fill="currentColor" opacity="0.28" />)
  if (id === 'beamer') {
    return (
      <svg viewBox="0 0 64 48" className="thumb">
        <rect x="2" y="6" width="60" height="36" rx="3" fill="var(--thumb-paper)" />
        <rect x="2" y="6" width="60" height="8" rx="3" fill={accent} />
        <rect x="10" y="20" width="30" height="2.5" rx="1" fill="currentColor" opacity="0.35" />
        <circle cx="12" cy="28" r="1.3" fill={accent} />
        <rect x="16" y="27" width="26" height="2" rx="1" fill="currentColor" opacity="0.25" />
        <circle cx="12" cy="34" r="1.3" fill={accent} />
        <rect x="16" y="33" width="20" height="2" rx="1" fill="currentColor" opacity="0.25" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 64 80" className="thumb">
      <rect x="4" y="2" width="56" height="76" rx="3" fill="var(--thumb-paper)" />
      {id === 'cv' ? (
        <>
          <rect x="10" y="9" width="28" height="4" rx="1" fill={accent} />
          <rect x="10" y="22" width="16" height="2.5" rx="1" fill={accent} opacity="0.8" />
          <rect x="10" y="26" width="44" height="0.8" fill={accent} opacity="0.6" />
          {lines(3, 30)}
          <rect x="10" y="48" width="16" height="2.5" rx="1" fill={accent} opacity="0.8" />
          <rect x="10" y="52" width="44" height="0.8" fill={accent} opacity="0.6" />
          {lines(3, 56)}
        </>
      ) : id === 'letter' ? (
        <>
          {lines(3, 8, 18)}
          <rect x="36" y="20" width="18" height="2" rx="1" fill="currentColor" opacity="0.28" />
          <rect x="36" y="25" width="14" height="2" rx="1" fill="currentColor" opacity="0.28" />
          <rect x="10" y="36" width="20" height="2" rx="1" fill={accent} opacity="0.8" />
          {lines(5, 42)}
        </>
      ) : (
        <>
          <rect x="16" y="9" width="32" height="3.5" rx="1" fill={accent} />
          <rect x="24" y="15" width="16" height="2" rx="1" fill="currentColor" opacity="0.3" />
          {id !== 'blank' && (
            <>
              <rect x="10" y="24" width="18" height="2.5" rx="1" fill={accent} opacity="0.75" />
              {lines(3, 29)}
              {id === 'math' || id === 'article' ? (
                <text x="32" y="51" textAnchor="middle" fontSize="7" fontStyle="italic" fill="currentColor" opacity="0.55" fontFamily="serif">
                  ∫ e^x dx = e^x
                </text>
              ) : (
                lines(2, 45)
              )}
              <rect x="10" y="58" width="18" height="2.5" rx="1" fill={accent} opacity="0.75" />
              {lines(2, 63)}
            </>
          )}
          {id === 'blank' && lines(1, 24, 20)}
        </>
      )}
    </svg>
  )
}

export default function NewProjectModal(): React.JSX.Element {
  const [template, setTemplate] = useState('article')
  const [name, setName] = useState('Mon document')
  const [author, setAuthor] = useState(() => localStorage.getItem('lumen.author') ?? '')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('lumen.projectsDir')
    if (saved) setLocation(saved)
    else void window.api.paths().then((p) => setLocation(`${p.documents}/LaTeX`))
  }, [])

  const dir = `${location}/${slug(name)}`

  const create = async (): Promise<void> => {
    const t = TEMPLATES.find((t) => t.id === template)!
    setBusy(true)
    localStorage.setItem('lumen.author', author)
    localStorage.setItem('lumen.projectsDir', location)
    closeModal()
    await createProject(dir, t.files(name, author))
    setBusy(false)
  }

  return (
    <ModalFrame
      title="Nouveau projet"
      width={760}
      footer={
        <>
          <span className="footer-path" title={dir}>
            {dir.replace(/^\/Users\/[^/]+/, '~')}
          </span>
          <button className="btn ghost" onClick={closeModal}>
            Annuler
          </button>
          <button className="btn primary" disabled={!name.trim() || !location || busy} onClick={() => void create()}>
            Créer le projet
          </button>
        </>
      }
    >
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            className={`template${template === t.id ? ' selected' : ''}`}
            onClick={() => setTemplate(t.id)}
            onDoubleClick={() => void create()}
            style={{ '--tpl-accent': t.accent } as React.CSSProperties}
          >
            <TemplateThumb id={t.id} accent={t.accent} />
            <span className="tpl-name">{t.name}</span>
            <span className="tpl-desc">{t.description}</span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>Titre</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void create()} />
        <label>Auteur</label>
        <input className="input" value={author} placeholder="Prénom Nom" onChange={(e) => setAuthor(e.target.value)} />
        <label>Emplacement</label>
        <div className="input-row">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              const d = await window.api.chooseDir(location)
              if (d) setLocation(d)
            }}
          >
            <FolderOpen size={14} /> Choisir…
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}
