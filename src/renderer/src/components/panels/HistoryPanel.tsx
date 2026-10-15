import { ChevronDown, ChevronRight, FileDiff, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HistoryVersion } from '../../../../shared/types'
import { textOf } from '../../editor/setup'
import { dateLabel, deleteVersion, listVersions, readVersionFile, renameVersion, restore, saveNamedVersion } from '../../lib/history'
import { store, toast, useApp } from '../../store'

/** Fichiers ajoutés, modifiés ou retirés d'une version par rapport à la précédente */
function changesOf(v: HistoryVersion, prev: HistoryVersion | undefined): { path: string; kind: 'ajouté' | 'modifié' | 'retiré' }[] {
  const out: { path: string; kind: 'ajouté' | 'modifié' | 'retiré' }[] = []
  for (const [p, h] of Object.entries(v.files)) {
    const before = prev?.files[p]
    if (!before) out.push({ path: p, kind: 'ajouté' })
    else if (before !== h) out.push({ path: p, kind: 'modifié' })
  }
  if (prev) for (const p of Object.keys(prev.files)) if (!(p in v.files)) out.push({ path: p, kind: 'retiré' })
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Compare le fichier de la version avec son état actuel (dans l'éditeur s'il y est ouvert) */
async function compare(v: HistoryVersion, rel: string): Promise<void> {
  const root = store.get().root
  if (!root) return
  try {
    const before = await readVersionFile(v.id, rel)
    let after = textOf(rel)
    if (after === null) after = await window.api.read(root, rel).catch(() => '')
    store.set({
      modal: {
        type: 'diff',
        title: rel,
        before,
        after,
        beforeLabel: v.name ? `« ${v.name} » (${dateLabel(v.date).toLowerCase()})` : dateLabel(v.date),
        afterLabel: 'Maintenant'
      }
    })
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
  }
}

function VersionItem({ v, prev }: { v: HistoryVersion; prev: HistoryVersion | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const changes = useMemo(() => changesOf(v, prev), [v, prev])
  const files = all ? Object.keys(v.files).sort().map((path) => ({ path, kind: undefined })) : changes.filter((c) => c.kind !== 'retiré')
  const time = new Date(v.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`hist-item${open ? ' open' : ''}${v.auto ? '' : ' named'}`}>
      <button className="hist-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="hist-time">{time}</span>
        <span className="hist-name">{v.name ?? 'Version automatique'}</span>
        <span className="hist-count">
          {!prev ? 'première' : changes.length ? `${changes.length} fichier${changes.length > 1 ? 's' : ''}` : 'sans changement'}
        </span>
      </button>
      {open && (
        <div className="hist-body">
          {files.length ? (
            files.map((c) => (
              <div key={c.path} className="hist-file">
                <span className="hist-path" title={c.path}>
                  {c.path}
                  {c.kind && <small> · {c.kind}</small>}
                </span>
                <button className="icon-btn subtle" title="Comparer avec maintenant" onClick={() => void compare(v, c.path)}>
                  <FileDiff size={13} />
                </button>
                <button className="icon-btn subtle" title="Restaurer ce fichier" onClick={() => void restore(v, [c.path])}>
                  <RotateCcw size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="hist-empty">Aucun fichier modifié depuis la version précédente.</div>
          )}
          <div className="hist-actions">
            <button className="link-btn" onClick={() => setAll(!all)}>
              {all ? 'Fichiers modifiés seulement' : `Tous les fichiers (${Object.keys(v.files).length})`}
            </button>
            <span className="hist-spacer" />
            <button className="icon-btn subtle" title="Restaurer toute la version" onClick={() => void restore(v)}>
              <RotateCcw size={14} />
            </button>
            <button className="icon-btn subtle" title={v.name ? 'Renommer' : 'Nommer (la version sera gardée)'} onClick={() => void renameVersion(v)}>
              <Pencil size={13} />
            </button>
            <button className="icon-btn subtle" title="Supprimer cette version" onClick={() => void deleteVersion(v)}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Historique des versions du projet : enregistrer une version, comparer, restaurer */
export default function HistoryPanel(): React.JSX.Element {
  const root = useApp((s) => s.root)
  const tick = useApp((s) => s.historyVersion)
  const auto = useApp((s) => s.settings.historyAuto)
  const guest = useApp((s) => s.collab.active && s.collab.role === 'guest')
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null)
  useEffect(() => {
    void listVersions().then(setVersions)
  }, [root, tick])

  // Par jour, de la plus récente à la plus ancienne
  const days = useMemo(() => {
    const out: { day: string; items: { v: HistoryVersion; prev: HistoryVersion | undefined }[] }[] = []
    ;(versions ?? []).forEach((v, i, all) => {
      const day = new Date(v.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const group = out[out.length - 1]?.day === day ? out[out.length - 1] : (out[out.length] = { day, items: [] })
      group.items.push({ v, prev: all[i + 1] })
    })
    return out
  }, [versions])

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Historique</span>
        <button className="btn small primary" disabled={guest} onClick={() => void saveNamedVersion()} title="Garder l’état actuel du projet sous un nom">
          <Save size={13} /> Enregistrer une version
        </button>
      </div>
      <div className="panel-body hist-panel">
        {guest ? (
          <div className="panel-empty">Pendant une session, c’est le chef de session qui garde l’historique du projet.</div>
        ) : versions === null ? (
          <div className="panel-empty">Chargement…</div>
        ) : !versions.length ? (
          <div className="panel-empty">
            Aucune version pour l’instant.{' '}
            {auto === false
              ? 'Les versions automatiques sont désactivées (Réglages → Éditeur).'
              : 'Lumen TeX garde une version automatiquement quand vous travaillez (toutes les 10 minutes au plus).'}{' '}
            « Enregistrer une version » garde l’état actuel sous un nom.
          </div>
        ) : (
          days.map((d) => (
            <section key={d.day}>
              <div className="section-label">{d.day}</div>
              {d.items.map(({ v, prev }) => (
                <VersionItem key={v.id} v={v} prev={prev} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
