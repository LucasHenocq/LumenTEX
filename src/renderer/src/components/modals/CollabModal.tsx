import { ChevronDown, ChevronRight, Copy, Crown, FolderDown, LogOut, Users, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FileRight, UserRight } from '../../../../shared/types'
import { closeProject } from '../../lib/actions'
import {
  amHost,
  becomeHost,
  formatCode,
  isGuestSession,
  joinSession,
  keepCopy,
  setCopies,
  setFileRight,
  setUserRight,
  shareProject,
  stopSession
} from '../../lib/collab'
import { store, toast, updateSettings, useApp, type CollabState } from '../../store'
import { closeModal, ModalFrame } from '../Modals'

/**
 * État du réseau en mots simples (jamais d'erreur technique : les détails vont dans collab.log).
 * tone : ok (vert), wait (neutre), warn (orange)
 */
/** Personnes présentes : jointes directement ou par l'intermédiaire d'un autre participant */
export const presentCount = (c: CollabState): number => (c.net.peers > 0 ? Math.max(c.net.peers, c.people.length) : 0)

export function collabMessage(c: CollabState, waitedLong = false): { tone: 'ok' | 'wait' | 'warn'; title: string; text?: string } {
  const { state } = c.net
  const peers = presentCount(c)
  if (state === 'unavailable')
    return {
      tone: 'warn',
      title: 'Le partage n’est pas disponible sur cet ordinateur',
      text: 'Le module réseau de Lumen TeX n’a pas pu démarrer. L’édition seule fonctionne normalement ; réinstaller Lumen TeX règle généralement le problème.'
    }
  if (state === 'network')
    return {
      tone: 'warn',
      title: 'Le réseau de partage ne répond pas',
      text:
        'Vérifie ta connexion Internet. Certains réseaux (école, entreprise) bloquent les connexions directes entre ordinateurs : essaie un autre réseau, par exemple un partage de connexion. Les personnes connectées au même Wi-Fi que toi restent joignables. Lumen TeX continue d’essayer' +
        (c.joining ? '.' : ' ; tes modifications seront fusionnées au retour.')
    }
  if (state === 'starting' || state === 'searching') return { tone: 'wait', title: 'Connexion au réseau de partage…' }
  if (peers > 0) {
    if (c.joining) return { tone: 'wait', title: 'Réception du projet…' }
    return { tone: 'ok', title: peers === 1 ? '1 personne connectée' : `${peers} personnes connectées` }
  }
  if (c.joining)
    return waitedLong
      ? {
          tone: 'warn',
          title: 'Personne de la session n’est connecté pour l’instant',
          text: 'Au moins une personne de la session doit avoir Lumen TeX ouvert sur ce projet. Vérifie aussi le code. Lumen TeX continue d’attendre.'
        }
      : { tone: 'wait', title: 'Recherche des participants…' }
  return { tone: 'wait', title: 'En attente de participants', text: 'Envoie le code à tes amis : ils le saisissent dans « Rejoindre une session ».' }
}

function Banner({ c, waitedLong }: { c: CollabState; waitedLong?: boolean }): React.JSX.Element {
  const m = collabMessage(c, waitedLong)
  return (
    <div className={`collab-banner ${m.tone}`}>
      {m.tone === 'warn' ? <WifiOff size={16} /> : <span className={`collab-dot ${m.tone}`} />}
      <div>
        <strong>{m.title}</strong>
        {m.text && <p>{m.text}</p>}
      </div>
    </div>
  )
}

function NameField(): React.JSX.Element {
  const name = useApp((s) => s.settings.collabName)
  const [fallback, setFallback] = useState('')
  useEffect(() => void window.api.userName().then(setFallback), [])
  return (
    <label className="collab-field">
      <span>Ton nom (visible par les autres)</span>
      <input className="input" value={name} placeholder={fallback} maxLength={40} onChange={(e) => void updateSettings({ collabName: e.target.value })} />
    </label>
  )
}

function JoinForm({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [code, setCode] = useState('')
  const [invalid, setInvalid] = useState(false)
  const join = async (): Promise<void> => {
    if (!(await joinSession(code))) setInvalid(true)
  }
  return (
    <form
      className="collab-body"
      onSubmit={(e) => {
        e.preventDefault()
        void join()
      }}
    >
      <p className="collab-intro">
        Saisis le code reçu : le projet s’ouvre chez toi le temps de la session et vous éditez en même temps. À la fin, il est effacé
        de ton ordinateur (le chef de session peut te permettre d’en garder une copie).
      </p>
      <label className="collab-field">
        <span>Code de la session</span>
        <input
          className={`input collab-code-input${invalid ? ' invalid' : ''}`}
          value={code}
          autoFocus
          placeholder="XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          onChange={(e) => {
            setInvalid(false)
            setCode(e.target.value.toUpperCase())
          }}
        />
        {invalid && <small className="collab-error">Ce code n’est pas valide : il compte 16 caractères (lettres et chiffres).</small>}
      </label>
      <NameField />
      <div className="collab-actions">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            Retour
          </button>
        )}
        <button type="submit" className="btn primary" disabled={code.replace(/[^0-9A-Z]/gi, '').length < 16}>
          Rejoindre
        </button>
      </div>
    </form>
  )
}

const USER_RIGHTS: [UserRight, string, string][] = [
  ['ro', 'Lecture seule', 'Voit le projet et la discussion, sans rien modifier'],
  ['rw', 'Modification', 'Modifie les fichiers existants'],
  ['add', 'Modification et ajout', 'Modifie, crée, importe, renomme et supprime des fichiers']
]
const rightLabel = (r: UserRight): string => USER_RIGHTS.find(([k]) => k === r)![1]

const FILE_RIGHTS: [FileRight, string, string][] = [
  ['rw', 'Modifiable', 'Modifiable par ceux qui en ont le droit'],
  ['ro', 'Lecture seule', 'Visible par tous, modifiable par toi seul'],
  ['hidden', 'Invisible', 'Reste sur ton ordinateur, jamais envoyé aux autres']
]

/** Droits des fichiers du projet (chef de session) : liste repliable, un choix à trois positions par fichier */
function FileRights({ value, onChange }: { value: Record<string, FileRight>; onChange: (path: string, r: FileRight) => void }): React.JSX.Element {
  const files = useApp((s) => s.files)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const list = files.filter((f) => !f.isDir && f.path.toLowerCase().includes(filter.toLowerCase())).map((f) => f.path)
  const special = Object.values(value).filter((r) => r !== 'rw').length
  return (
    <div className="collab-section">
      <button type="button" className="collab-section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Droits des fichiers
        <small>{special ? `${special} fichier${special > 1 ? 's' : ''} protégé${special > 1 ? 's' : ''}` : 'tous modifiables'}</small>
      </button>
      {open && (
        <>
          {files.filter((f) => !f.isDir).length > 8 && (
            <input className="input" placeholder="Rechercher un fichier" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <div className="collab-files">
            {list.map((p) => (
              <div key={p} className="collab-file">
                <span title={p}>{p}</span>
                <div className="segmented">
                  {FILE_RIGHTS.map(([r, label, hint]) => (
                    <button key={r} type="button" title={hint} className={(value[p] ?? 'rw') === r ? 'on' : ''} onClick={() => onChange(p, r)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Droit d'une personne : choix pour le chef, simple mention pour les autres */
function PersonRight({ uid, c }: { uid: string; c: CollabState }): React.JSX.Element | null {
  if (!c.rules.host) return null
  if (uid === c.rules.host)
    return (
      <span className="collab-right host">
        <Crown size={11} /> chef
      </span>
    )
  const r = c.rules.users[uid] ?? 'ro'
  if (!amHost()) return <span className="collab-right">{rightLabel(r)}</span>
  return (
    <select className="collab-right-select" value={r} title={USER_RIGHTS.find(([k]) => k === r)![2]} onChange={(e) => setUserRight(uid, e.target.value as UserRight)}>
      {USER_RIGHTS.map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  )
}

function Joining({ c }: { c: CollabState }): React.JSX.Element {
  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setWaitedLong(true), 20000)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="collab-body">
      <Banner c={c} waitedLong={waitedLong} />
      <p className="collab-muted">Session {formatCode(c.code)}</p>
      <div className="collab-actions">
        <button className="btn" onClick={() => void stopSession({ forget: false })}>
          Annuler
        </button>
      </div>
    </div>
  )
}

function InSession({ c }: { c: CollabState }): React.JSX.Element {
  const settingsName = useApp((s) => s.settings.collabName)
  const me = useApp((s) => s.settings.collabUserId)
  const root = useApp((s) => s.root)
  const hidden = useApp((s) => (root ? s.settings.projects[root]?.collabHidden : undefined)) ?? []
  const guest = isGuestSession()
  const host = amHost()
  const copy = (): void => {
    void navigator.clipboard.writeText(formatCode(c.code))
    toast('Code copié', 'success')
  }
  const leave = async (): Promise<void> => {
    const ok = await window.api.confirm(
      'Quitter la session partagée ?',
      guest
        ? `Le projet sera effacé de ton ordinateur.${c.rules.copies ? ' Pour le conserver, garde d’abord une copie.' : ''} Pour revenir, il faudra de nouveau le code.`
        : 'Tes fichiers restent sur ton ordinateur, mais ne seront plus synchronisés. Pour revenir, il faudra de nouveau le code.',
      'Quitter la session'
    )
    if (!ok) return
    closeModal()
    // Invité : fermer le projet met fin à la session et efface la copie de travail
    if (guest) await closeProject()
    else await stopSession({ forget: true })
  }
  const keep = async (): Promise<void> => {
    try {
      const dest = await keepCopy()
      if (dest) toast(`Copie enregistrée dans « ${dest.split(/[\\/]/).slice(-2).join(' / ')} »`, 'success', { label: 'Afficher', run: () => void window.api.reveal(dest) }, 8000)
    } catch {
      toast('La copie n’a pas pu être enregistrée', 'error')
    }
  }
  const fileRights: Record<string, FileRight> = { ...c.rules.files }
  for (const p of hidden) fileRights[p] = 'hidden'
  const myRight = c.rules.host && c.rules.host !== me ? (c.rules.users[me] ?? 'ro') : null
  return (
    <div className="collab-body">
      <Banner c={c} />
      <div className="collab-code-box">
        <span className="collab-code">{formatCode(c.code)}</span>
        <button className="btn" onClick={copy}>
          <Copy size={14} /> Copier
        </button>
      </div>
      <p className="collab-muted">
        Envoie ce code à tes amis : il donne accès au projet, ne le partage qu’avec eux. Les ordinateurs se connectent directement,
        sans serveur.
      </p>
      {myRight && myRight !== 'add' && (
        <p className="collab-muted">
          {myRight === 'ro'
            ? 'Tu es en lecture seule : tu vois le projet et peux discuter, sans rien modifier. Le chef de session peut te donner le droit de modifier.'
            : 'Tu peux modifier les fichiers existants, mais pas en ajouter, renommer ou supprimer.'}
        </p>
      )}
      <div className="collab-people">
        <div className="collab-person">
          <span className="collab-dot ok" /> {settingsName || 'Toi'} <small>(toi)</small>
          <PersonRight uid={me} c={c} />
        </div>
        {c.people.map((p) => (
          <div key={p.id} className="collab-person">
            <span className="collab-dot" style={{ background: p.color }} /> {p.name}
            {p.file && <small>{p.file}</small>}
            {p.uid && <PersonRight uid={p.uid} c={c} />}
          </div>
        ))}
      </div>
      {host && (
        <>
          <FileRights value={fileRights} onChange={(p, r) => void setFileRight(p, r)} />
          <label className="checkbox">
            <input type="checkbox" checked={c.rules.copies} onChange={(e) => setCopies(e.target.checked)} /> Les invités peuvent garder une copie du
            projet
          </label>
        </>
      )}
      {!c.rules.host && !guest && (
        <p className="collab-muted">
          Session créée avant les droits : tout le monde peut tout modifier.{' '}
          <button className="link-btn" onClick={becomeHost}>
            Devenir chef de session
          </button>{' '}
          pour choisir qui modifie quoi (les autres passent alors en lecture seule).
        </p>
      )}
      {c.tooBig.length > 0 && (
        <div className="collab-toobig">
          <strong>Non partagés (plus de 15 Mo, restent sur ton ordinateur) :</strong>
          {c.tooBig.map((f) => (
            <span key={f.path}>
              {f.path} <small>({Math.max(1, Math.round(f.size / 1e6))} Mo)</small>
            </span>
          ))}
        </div>
      )}
      <div className="collab-actions">
        {guest && c.rules.copies && (
          <button className="btn ghost" onClick={() => void keep()}>
            <FolderDown size={14} /> Garder une copie
          </button>
        )}
        <button className="btn ghost" onClick={() => void leave()}>
          <LogOut size={14} /> Quitter la session
        </button>
      </div>
    </div>
  )
}

export default function CollabModal({ join }: { join?: boolean }): React.JSX.Element {
  const c = useApp((s) => s.collab)
  const root = useApp((s) => s.root)
  const projectName = useApp((s) => s.projectName)
  const [mode, setMode] = useState<'share' | 'join'>(join || !root ? 'join' : 'share')
  const [busy, setBusy] = useState(false)
  const [copies, setCopiesBefore] = useState(true)
  const [files, setFiles] = useState<Record<string, FileRight>>({})

  let body: React.JSX.Element
  if (c.active && c.joining) body = <Joining c={c} />
  else if (c.active) body = <InSession c={c} />
  else if (mode === 'join') body = <JoinForm onBack={root ? () => setMode('share') : undefined} />
  else
    body = (
      <div className="collab-body">
        <p className="collab-intro">
          Travaille sur « {projectName} » avec tes amis, en direct : chacun voit le texte et le curseur des autres, et compile le PDF chez
          lui. Les ordinateurs se connectent directement, sans serveur ni compte.
        </p>
        <NameField />
        <p className="collab-muted">
          Tu seras le chef de cette session. Les personnes qui la rejoignent arrivent en lecture seule : tu pourras leur permettre de
          modifier, et celles à qui tu l’as déjà permis dans une autre session le retrouvent.
        </p>
        <FileRights value={files} onChange={(p, r) => setFiles({ ...files, [p]: r })} />
        <label className="checkbox">
          <input type="checkbox" checked={copies} onChange={(e) => setCopiesBefore(e.target.checked)} /> Les invités peuvent garder une copie du
          projet
        </label>
        <div className="collab-actions">
          <button className="btn ghost" onClick={() => setMode('join')}>
            Rejoindre une autre session
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await shareProject({ copies, files })
              setBusy(false)
            }}
          >
            <Users size={14} /> {busy ? 'Préparation…' : 'Partager ce projet'}
          </button>
        </div>
      </div>
    )

  return (
    <ModalFrame title={c.active && !c.joining ? 'Session partagée' : mode === 'join' || c.joining ? 'Rejoindre une session' : 'Travailler à plusieurs'} width={520} className="collab-modal">
      {body}
    </ModalFrame>
  )
}

/** Ouvre la fenêtre de partage */
export const openCollab = (join?: boolean): void => store.set({ modal: { type: 'collab', join } })
