import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting
} from '@codemirror/language'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding
} from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import type { Settings } from '../../../shared/types'
import { bibHighlight, bibLanguage, latexHighlight, latexLanguage } from '../latex/language'
import { store } from '../store'
import { latexCompletionSources } from './complete'
import { fileFacet, frenchPhrases, latexFolding, latexLinter, mathHover, wrapSelection } from './features'

/** Crochets vers la logique applicative (renseignés par actions.ts, évite les imports circulaires) */
export const hooks = {
  onDocChanged: (_path: string, _state: EditorState): void => {},
  onSelection: (_state: EditorState): void => {},
  syncForward: (_path: string, _line: number): void => {},
  dropFiles: (_files: File[], _view: EditorView, _pos: number): void => {}
}

export interface OpenDoc {
  state: EditorState
  saved: Text
  scrollTop: number
}

export const docs = new Map<string, OpenDoc>()
let view: EditorView | null = null
let activePath: string | null = null

export const getView = (): EditorView | null => view
export const getActivePath = (): string | null => activePath

// Compartiments réglables à chaud
const vimC = new Compartment()
const wrapC = new Compartment()
const attrsC = new Compartment()
const mathC = new Compartment()

function settingsExtensions(s: Settings): { vim: Extension; wrap: Extension; attrs: Extension; math: Extension } {
  return {
    vim: s.vimMode ? vim() : [],
    wrap: s.lineWrapping ? EditorView.lineWrapping : [],
    attrs: EditorView.contentAttributes.of({
      spellcheck: s.spellcheck ? 'true' : 'false',
      autocorrect: 'off',
      autocapitalize: 'off'
    }),
    math: s.mathPreview ? mathHover : []
  }
}

export function reconfigureAll(): void {
  if (!view) return
  const e = settingsExtensions(store.get().settings)
  const tex = !!activePath && /\.(tex|sty|cls|ltx)$/i.test(activePath)
  view.dispatch({
    effects: [vimC.reconfigure(e.vim), wrapC.reconfigure(e.wrap), attrsC.reconfigure(e.attrs), mathC.reconfigure(tex ? e.math : [])]
  })
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)', fontSize: 'var(--editor-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '14px 0 40vh' },
  '.cm-line': { padding: '0 18px 0 10px' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important'
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-faint)', border: 'none', paddingLeft: '6px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px', padding: '0 6px 0 4px', fontSize: '0.86em' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-faint)', cursor: 'pointer', padding: '0 4px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--chip)', border: 'none', color: 'var(--text-muted)', padding: '0 6px', borderRadius: '4px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--match-bg)', outline: '1px solid var(--match-border)', color: 'inherit !important' },
  '.cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-lg)', color: 'var(--text)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--editor-font)', maxHeight: '18em', padding: '4px' },
  '.cm-tooltip-autocomplete > ul > li': { borderRadius: '5px', padding: '3px 8px !important', lineHeight: '1.5' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': { color: 'var(--on-accent)', opacity: '0.8' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '12px', fontSize: '0.85em' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-completionInfo': { padding: '8px 10px', maxWidth: '320px', whiteSpace: 'pre-wrap', fontSize: '12.5px' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border) !important' },
  '.cm-panel.cm-search': { padding: '8px 12px', fontFamily: 'var(--ui-font)', fontSize: '12.5px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--ui-font)', fontSize: '12.5px' },
  '.cm-textfield': { backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--chip)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', padding: '3px 10px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', right: '10px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--text-faint)', textUnderlineOffset: '3px' },
  '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'var(--ui-font)', fontSize: '12.5px', whiteSpace: 'pre-wrap' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warning)' },
  '.cm-diagnostic-info': { borderLeft: '3px solid var(--text-faint)' },
  '.cm-lint-marker': { width: '0.8em', height: '0.8em' },
  '.cm-gutter-lint': { width: '14px' }
})

const customKeys: KeyBinding[] = [
  { key: 'Mod-b', run: (v) => wrapSelection(v, '\\textbf{', '}') },
  { key: 'Mod-i', run: (v) => wrapSelection(v, '\\textit{', '}') },
  { key: 'Mod-u', run: (v) => wrapSelection(v, '\\underline{', '}') },
  { key: 'Mod-Shift-e', run: (v) => wrapSelection(v, '\\emph{', '}') },
  { key: 'Mod-m', run: (v) => wrapSelection(v, '$', '$') }
]

function languageFor(path: string): Extension {
  if (/\.(tex|sty|cls|ltx|dtx|tikz)$/i.test(path)) {
    return [latexLanguage, syntaxHighlighting(latexHighlight), latexFolding, latexLinter]
  }
  if (/\.bib$/i.test(path)) return [bibLanguage, syntaxHighlighting(bibHighlight)]
  return []
}

export function createState(path: string, text: string): EditorState {
  const s = settingsExtensions(store.get().settings)
  const isTex = /\.(tex|sty|cls|ltx)$/i.test(path)
  return EditorState.create({
    doc: text,
    extensions: [
      vimC.of(s.vim),
      fileFacet.of(path),
      EditorState.phrases.of(frenchPhrases),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: isTex ? latexCompletionSources : undefined,
        activateOnTyping: true,
        icons: false,
        closeOnBlur: true,
        maxRenderedOptions: 80
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        ...customKeys,
        ...closeBracketsKeymap,
        ...defaultKeymap.filter((k) => k.key !== 'Mod-Enter'),
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab
      ]),
      languageFor(path),
      isTex ? lintGutter() : [],
      mathC.of(isTex ? s.math : []),
      wrapC.of(s.wrap),
      attrsC.of(s.attrs),
      editorTheme,
      EditorView.updateListener.of((u) => {
        const p = u.state.facet(fileFacet)
        if (u.docChanged) hooks.onDocChanged(p, u.state)
        if (u.selectionSet || u.docChanged) hooks.onSelection(u.state)
      }),
      EditorView.domEventHandlers({
        mousedown(e, v) {
          if (!(window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey) || e.button !== 0) return false
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos == null) return false
          e.preventDefault()
          hooks.syncForward(v.state.facet(fileFacet), v.state.doc.lineAt(pos).number)
          return true
        },
        drop(e, v) {
          const files = [...(e.dataTransfer?.files ?? [])]
          if (!files.length) return false
          e.preventDefault()
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head
          hooks.dropFiles(files, v, pos)
          return true
        }
      })
    ]
  })
}

export function attachView(parent: HTMLElement): EditorView {
  view = new EditorView({ parent, state: EditorState.create({ doc: '' }) })
  return view
}

export function detachView(): void {
  if (view && activePath && docs.has(activePath)) docs.get(activePath)!.state = view.state
  view?.destroy()
  view = null
}

/** État courant d'un document (celui de la vue s'il est actif) */
export function stateOf(path: string): EditorState | null {
  if (path === activePath && view) return view.state
  return docs.get(path)?.state ?? null
}

export function textOf(path: string): string | null {
  return stateOf(path)?.doc.toString() ?? null
}

export function isDirty(path: string): boolean {
  const d = docs.get(path)
  const st = stateOf(path)
  return !!d && !!st && !st.doc.eq(d.saved)
}

export function showDoc(path: string | null): void {
  if (!view) return
  if (activePath && docs.has(activePath)) {
    const d = docs.get(activePath)!
    d.state = view.state
    d.scrollTop = view.scrollDOM.scrollTop
  }
  activePath = path
  if (!path || !docs.has(path)) {
    view.setState(EditorState.create({ doc: '' }))
    return
  }
  const d = docs.get(path)!
  view.setState(d.state)
  reconfigureAll()
  const top = d.scrollTop
  setTimeout(() => {
    if (view && top) view.scrollDOM.scrollTop = top
  }, 0)
  hooks.onSelection(view.state)
}

export function openDoc(path: string, text: string): void {
  if (docs.has(path)) return
  const state = createState(path, text)
  docs.set(path, { state, saved: state.doc, scrollTop: 0 })
}

export function closeDoc(path: string): void {
  if (path === activePath) activePath = null
  docs.delete(path)
}

export function markSaved(path: string): void {
  const d = docs.get(path)
  const st = stateOf(path)
  if (d && st) d.saved = st.doc
}

/** Remplace le contenu d'un document (modification externe) en conservant l'historique */
export function replaceContent(path: string, text: string): void {
  const d = docs.get(path)
  if (!d) return
  if (path === activePath && view) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'external' })
    d.saved = view.state.doc
  } else {
    d.state = d.state.update({ changes: { from: 0, to: d.state.doc.length, insert: text } }).state
    d.saved = d.state.doc
  }
}

export function renameDoc(from: string, to: string): void {
  const d = docs.get(from)
  if (!d) return
  const text = stateOf(from)!.doc.toString()
  const wasActive = activePath === from
  const saved = d.saved
  docs.delete(from)
  const state = createState(to, text)
  docs.set(to, { state, saved: saved.eq(state.doc) ? state.doc : saved, scrollTop: d.scrollTop })
  if (wasActive) {
    activePath = null
    showDoc(to)
  }
}
