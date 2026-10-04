import { ChevronRight, EyeOff, FilePlus, FolderPlus, Import, Lock, RefreshCw, ChevronsDownUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CONVERTIBLE } from '../../../../shared/convert'
import type { ContextMenuItem, FileEntry } from '../../../../shared/types'
import {
  createEntry,
  deleteEntry,
  importFiles,
  insertBlock,
  moveEntry,
  openFile,
  refreshFiles,
  renameEntry,
  setMainFile
} from '../../lib/actions'
import { on } from '../../lib/bus'
import { canAdd, canWrite, isGuestSession } from '../../lib/collab'
import { store, useApp } from '../../store'
import FileIcon from '../FileIcon'

interface Node {
  name: string
  path: string
  isDir: boolean
  children: Node[]
}

function buildTree(files: FileEntry[]): Node[] {
  const root: Node = { name: '', path: '', isDir: true, children: [] }
  const dirs = new Map<string, Node>([['', root]])
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  for (const f of sorted) {
    const parentPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    const parent = dirs.get(parentPath) ?? root
    const node: Node = { name: f.path.split('/').pop()!, path: f.path, isDir: f.isDir, children: [] }
    parent.children.push(node)
    if (f.isDir) dirs.set(f.path, node)
  }
  const sort = (n: Node): void => {
    n.children.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'fr', { numeric: true })))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

const parentDir = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

type Editing = { kind: 'new-file' | 'new-dir'; dir: string } | { kind: 'rename'; path: string } | null

function InlineInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current!
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const finish = (v: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      ref={ref}
      className="tree-input"
      defaultValue={initial}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value.trim())
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
    />
  )
}

export default function FileTree(): React.JSX.Element {
  const files = useApp((s) => s.files)
  const active = useApp((s) => s.active)
  const mainFile = useApp((s) => s.mainFile)
  const dirty = useApp((s) => s.dirty)
  const diagnostics = useApp((s) => s.diagnostics)
  const projectName = useApp((s) => s.projectName)
  const root = useApp((s) => s.root)
  // Session partagée : droits (re-rendu à chaque changement), fichiers protégés signalés dans l'arbre
  const rules = useApp((s) => s.collab.rules)
  const hidden = useApp((s) => (s.collab.active && root ? s.settings.projects[root]?.collabHidden : undefined)) ?? []
  const add = rules && canAdd()
  const writable = (p: string, isDir: boolean): boolean =>
    isDir ? files.every((f) => f.isDir || !f.path.startsWith(p + '/') || canWrite(f.path)) : canWrite(p)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Editing>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Dernier élément cliqué dans l'arbre (fichier ou dossier) : cible de la touche Suppr
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null)
  // Élément déplacé par glisser-déposer dans l'arbre (null : fichiers venant de l'Explorateur)
  const dragged = useRef<string | null>(null)
  const tree = useMemo(() => buildTree(files), [files])

  const errorFiles = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>()
    for (const d of diagnostics) {
      if (!d.file) continue
      if (d.severity === 'error') m.set(d.file, 'error')
      else if (d.severity === 'warning' && !m.has(d.file)) m.set(d.file, 'warning')
    }
    return m
  }, [diagnostics])

  // Déplier les dossiers du fichier actif
  useEffect(() => {
    if (!active?.includes('/')) return
    const parts = active.split('/').slice(0, -1)
    setExpanded((prev) => {
      const next = new Set(prev)
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/')))
      return next
    })
  }, [active])

  useEffect(
    () =>
      on('editor:command', (c) => {
        if (c === 'tree:new-file') setEditing({ kind: 'new-file', dir: currentDir() })
      }),
    [active]
  )

  const currentDir = (): string => (active?.includes('/') ? active.slice(0, active.lastIndexOf('/')) : '')

  const toggle = (p: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const contextMenu = async (e: React.MouseEvent, node: Node | null): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const dir = node ? (node.isDir ? node.path : node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '') : ''
    const items: ContextMenuItem[] = [
      { id: 'new-file', label: 'Nouveau fichier…', enabled: add },
      { id: 'new-dir', label: 'Nouveau dossier…', enabled: add },
      { id: 'import', label: 'Importer des fichiers…', enabled: add }
    ]
    if (node) {
      items.push({ type: 'separator' } as never)
      if (!node.isDir && /\.tex$/i.test(node.path) && node.path !== mainFile) items.push({ id: 'main', label: 'Définir comme fichier principal' })
      items.push({ id: 'rename', label: 'Renommer…', enabled: add && writable(node.path, node.isDir) }, { id: 'copy-path', label: 'Copier le chemin relatif' })
      if (!node.isDir && /\.(png|jpe?g|pdf|eps|svg)$/i.test(node.path)) items.push({ id: 'insert-graphic', label: 'Insérer \\includegraphics' })
      if (!node.isDir && /\.tex$/i.test(node.path) && node.path !== mainFile) items.push({ id: 'insert-input', label: 'Insérer \\input' })
      if (!node.isDir && CONVERTIBLE.test(node.path)) items.push({ id: 'convert', label: 'Convertir en LaTeX avec l’IA…' })
      // Invité sans droit de copie : l'emplacement de la copie de travail n'est pas montré
      if (!(isGuestSession() && !rules.copies))
        items.push({
          id: 'reveal',
          label: window.api.platform === 'darwin' ? 'Afficher dans le Finder' : window.api.platform === 'win32' ? 'Afficher dans l’Explorateur' : 'Afficher dans le dossier'
        })
      items.push(
        { type: 'separator' } as never,
        { id: 'delete', label: 'Mettre à la corbeille', accelerator: window.api.platform === 'darwin' ? 'Cmd+Backspace' : 'Delete', enabled: writable(node.path, node.isDir) }
      )
    }
    const choice = await window.api.popupMenu(items)
    if (!choice) return
    switch (choice) {
      case 'new-file':
      case 'new-dir':
        if (dir) setExpanded((p) => new Set(p).add(dir))
        setEditing({ kind: choice, dir })
        break
      case 'import': {
        const src = await window.api.openFileDialog({ title: 'Importer un fichier dans le projet' })
        if (src) await importFiles([src], dir)
        break
      }
      case 'main':
        void setMainFile(node!.path)
        break
      case 'rename':
        setEditing({ kind: 'rename', path: node!.path })
        break
      case 'copy-path':
        void navigator.clipboard.writeText(node!.path)
        break
      case 'insert-graphic':
      case 'insert-input': {
        const main = store.get().mainFile ?? ''
        const base = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : ''
        let p = node!.path.startsWith(base) ? node!.path.slice(base.length) : node!.path
        if (choice === 'insert-input') insertBlock(`\\input{${p.replace(/\.tex$/i, '')}}\n`, false)
        else {
          p = p.replace(/\\/g, '/')
          insertBlock(`\\includegraphics[width=\${0.8}\\linewidth]{${p}}\n`)
        }
        break
      }
      case 'convert':
        store.set({ modal: { type: 'convert', file: `${root}/${node!.path}` } })
        break
      case 'reveal':
        void window.api.reveal(`${root}/${node!.path}`)
        break
      case 'delete':
        void deleteEntry(node!.path, node!.isDir)
        break
    }
  }

  /** Déplacement interne possible vers dir ? (pas sur place, pas un dossier dans lui-même) */
  const canMoveTo = (src: string, dir: string): boolean => dir !== parentDir(src) && dir !== src && !dir.startsWith(src + '/')

  const onDragOverDir = (e: React.DragEvent, dir: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const src = dragged.current
    if (src && !canMoveTo(src, dir)) {
      e.dataTransfer.dropEffect = 'none'
      setDropTarget(null)
      return
    }
    e.dataTransfer.dropEffect = src ? 'move' : 'copy'
    setDropTarget(dir)
  }

  const onDropFiles = async (e: React.DragEvent, dir: string): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const src = dragged.current
    dragged.current = null
    if (src) {
      if (!canMoveTo(src, dir)) return
      const to = dir ? `${dir}/${src.split('/').pop()}` : src.split('/').pop()!
      await moveEntry(src, to)
      if (dir) setExpanded((p) => new Set(p).add(dir))
      setSelected((s) => (s?.path === src ? { ...s, path: to } : s))
      return
    }
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) await importFiles(paths, dir)
  }

  const renderNode = (node: Node, depth: number): React.JSX.Element => {
    const isOpen = expanded.has(node.path)
    const isEditingThis = editing?.kind === 'rename' && editing.path === node.path
    const err = errorFiles.get(node.path)
    return (
      <div key={node.path}>
        <div
          className={`tree-row${active === node.path ? ' active' : ''}${selected?.path === node.path ? ' selected' : ''}${dropTarget === node.path ? ' drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            setSelected({ path: node.path, isDir: node.isDir })
            if (node.isDir) toggle(node.path)
            else void openFile(node.path)
          }}
          onContextMenu={(e) => {
            setSelected({ path: node.path, isDir: node.isDir })
            void contextMenu(e, node)
          }}
          draggable={!isEditingThis}
          onDragStart={(e) => {
            dragged.current = node.path
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', node.path)
          }}
          onDragEnd={() => {
            dragged.current = null
            setDropTarget(null)
          }}
          // Déposé sur un dossier : dedans ; sur un fichier : dans son dossier (la racine gère le niveau 0).
          // dragenter doit être accepté comme dragover, sinon le navigateur refuse le dépôt
          onDragEnter={(e) => {
            const dir = node.isDir ? node.path : parentDir(node.path)
            if (dir) onDragOverDir(e, dir)
          }}
          onDragOver={(e) => {
            const dir = node.isDir ? node.path : parentDir(node.path)
            if (dir) onDragOverDir(e, dir)
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            const dir = node.isDir ? node.path : parentDir(node.path)
            if (dir) void onDropFiles(e, dir)
          }}
          title={node.path}
        >
          <span className={`tree-chevron${node.isDir ? '' : ' hidden'}${isOpen ? ' open' : ''}`}>
            <ChevronRight size={13} />
          </span>
          <FileIcon name={node.name} isDir={node.isDir} open={isOpen} />
          {isEditingThis ? (
            <InlineInput
              initial={node.name}
              onDone={(v) => {
                setEditing(null)
                if (v && v !== node.name) void renameEntry(node.path, v)
              }}
            />
          ) : (
            <span className={`tree-name${err ? ` has-${err}` : ''}`}>{node.name}</span>
          )}
          {node.path === mainFile && <span className="tree-badge" title="Fichier principal">principal</span>}
          {rules.files[node.path] && (
            <span className="tree-lock" title="Lecture seule dans la session partagée">
              <Lock size={11} />
            </span>
          )}
          {hidden.includes(node.path) && (
            <span className="tree-lock" title="Invisible pour les autres participants">
              <EyeOff size={11} />
            </span>
          )}
          {dirty[node.path] && <span className="tree-dirty" />}
        </div>
        {node.isDir && isOpen && (
          <div className="tree-children">
            {editing && editing.kind !== 'rename' && editing.dir === node.path && renderCreate(depth + 1)}
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderCreate = (depth: number): React.JSX.Element => (
    <div className="tree-row editing" style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="tree-chevron hidden">
        <ChevronRight size={13} />
      </span>
      <FileIcon name={editing?.kind === 'new-dir' ? '' : 'x.tex'} isDir={editing?.kind === 'new-dir'} />
      <InlineInput
        initial={editing?.kind === 'new-dir' ? 'dossier' : 'nouveau.tex'}
        onDone={(v) => {
          const e = editing
          setEditing(null)
          if (v && e && e.kind !== 'rename') void createEntry(e.dir, v, e.kind === 'new-dir')
        }}
      />
    </div>
  )

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{projectName}</span>
        <div className="panel-actions">
          <button className="icon-btn subtle" disabled={!add} title="Nouveau fichier" onClick={() => setEditing({ kind: 'new-file', dir: '' })}>
            <FilePlus size={15} />
          </button>
          <button className="icon-btn subtle" disabled={!add} title="Nouveau dossier" onClick={() => setEditing({ kind: 'new-dir', dir: '' })}>
            <FolderPlus size={15} />
          </button>
          <button
            className="icon-btn subtle"
            title="Importer un fichier"
            disabled={!add}
            onClick={async () => {
              const src = await window.api.openFileDialog({ title: 'Importer un fichier dans le projet' })
              if (src) await importFiles([src], '')
            }}
          >
            <Import size={15} />
          </button>
          <button className="icon-btn subtle" title="Tout replier" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp size={15} />
          </button>
          <button className="icon-btn subtle" title="Actualiser" onClick={() => void refreshFiles()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div
        className={`panel-body tree${dropTarget === '' ? ' drop' : ''}`}
        // Focusable : un clic dans l'arbre lui donne le clavier (et le retire à l'éditeur)
        tabIndex={-1}
        onKeyDown={(e) => {
          // Suppr (⌘⌫ sur Mac) : seulement si l'arbre lui-même a le focus (pas pendant un renommage ou une création),
          // sur le dernier élément cliqué ; deleteEntry demande confirmation et passe par la corbeille
          const del = (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey) || (e.key === 'Backspace' && e.metaKey)
          if (!del || e.repeat || e.target !== e.currentTarget || editing || !selected) return
          if (!files.some((f) => f.path === selected.path)) return
          e.preventDefault()
          void deleteEntry(selected.path, selected.isDir)
        }}
        onContextMenu={(e) => void contextMenu(e, null)}
        onDragEnter={(e) => onDragOverDir(e, '')}
        onDragOver={(e) => onDragOverDir(e, '')}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => void onDropFiles(e, '')}
      >
        {editing && editing.kind !== 'rename' && editing.dir === '' && renderCreate(0)}
        {tree.map((n) => renderNode(n, 0))}
        {!tree.length && <div className="panel-empty">Dossier vide</div>}
      </div>
    </div>
  )
}
