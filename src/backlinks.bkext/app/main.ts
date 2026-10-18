import {
  AppExtensionContext,
  ChoiceBoxItem,
  CommandContext,
  DOMScriptHandle,
  Disposable,
  Image,
  Insets,
  MenuItem,
  Outline,
  OutlineEditor,
  Row,
  SymbolConfiguration,
  Text,
  Window,
} from 'bike/app'
import { BacklinksProtocol, BacklinksState, RowRef, backlinksDefaults } from '../dom/lib/protocol'
import { clip } from '../dom/lib/format'
import { IndexChange, OutlineIndex } from './index'
import { buildState, sortLinks } from './present'

const BADGE = 'backlinks'

// ---------------------------------------------------------------------------
// Indexes, one per open outline, keyed by the outline's root persistent id.

const indexes = new Map<string, OutlineIndex>()

function indexFor(outline: Outline): OutlineIndex | undefined {
  const key = outline.root.persistentId
  if (!key) return undefined
  let index = indexes.get(key)
  if (!index) {
    index = new OutlineIndex(outline)
    index.onChange((change) => onIndexChange(change))
    indexes.set(key, index)
  }
  return index
}

function dropIndex(outline: Outline) {
  const key = outline.root.persistentId
  if (!key) return
  indexes.get(key)?.dispose()
  indexes.delete(key)
}

function outlineForKey(key: string): Outline | undefined {
  return bike.documents.find((d) => d.outline.root.persistentId === key)?.outline
}

function rowForRef(ref: RowRef): Row | undefined {
  return outlineForKey(ref.outline)?.getRowById(ref.row)
}

// ---------------------------------------------------------------------------
// The inspector, one per window.

type View = {
  window: Window
  handle?: DOMScriptHandle<BacklinksProtocol>
  selection?: Disposable
  /** Outline and row last shown, to skip rebuilds while the caret stays put. */
  lastKey?: string
  /** Rows the view displays; a text edit to any of them refreshes it. */
  shown: Set<number>
}

const views = new Map<Window, View>()
const EMPTY: BacklinksState = { target: null, here: [], out: [], inside: [] }

/** Send the view its state. Without `force`, nothing happens while the caret stays in one row. */
function push(v: View, force = false) {
  const editor = v.window.currentOutlineEditor
  const index = editor && indexFor(editor.outline)
  const row = editor?.selection?.row
  const key = index && row ? `${index.key}:${row.id}` : ''
  if (!force && key === v.lastKey) return
  v.lastKey = key
  let state = EMPTY
  if (index && row) {
    const built = buildState(index, row)
    state = built.state
    v.shown = built.shown
  } else {
    v.shown = new Set()
  }
  v.handle?.postMessage({ type: 'state', state })
}

function pushAll() {
  for (const v of views.values()) push(v, true)
}

function onIndexChange(change: IndexChange) {
  if (change.linksChanged) updateBadges()
  for (const v of views.values()) {
    if (change.linksChanged || change.structural || [...change.touched].some((id) => v.shown.has(id))) push(v, true)
  }
}

function editorForRef(window: Window | undefined, ref: RowRef): OutlineEditor | undefined {
  const current = window?.currentOutlineEditor
  if (current && current.outline.root.persistentId === ref.outline) return current
  return bike.documents.find((d) => d.outline.root.persistentId === ref.outline)?.frontmostWindow?.currentOutlineEditor
}

/** Show a row, focusing out, expanding and clearing a filter only as needed. */
function goTo(editor: OutlineEditor, row: Row, char: number, moveCaret: boolean) {
  editor.transaction({ label: 'Go to Link', animate: { spring: 'navigation' } }, () => {
    editor.revealRow(row)
    if (!editor.isFocused(row) && editor.filter) editor.filter = undefined
    if (moveCaret) editor.selectCaret(row, Math.min(char, row.text.string.length))
  })
  if (moveCaret) editor.activate()
}

function wire(v: View, handle: DOMScriptHandle<BacklinksProtocol>) {
  handle.onmessage = (message) => {
    if (message.type === 'ready') return push(v, true)
    const row = rowForRef(message.ref)
    if (!row) return
    switch (message.type) {
      case 'go': {
        const editor = editorForRef(v.window, message.ref)
        if (editor) goTo(editor, row, message.char ?? 0, true)
        break
      }
      case 'focus': {
        // Zoom Bike into the linking row, as its own focus arrows do. Bike's back arrow returns.
        const editor = editorForRef(v.window, message.ref)
        if (!editor) break
        editor.transaction({ label: 'Focus', animate: { spring: 'navigation' } }, () => {
          if (editor.filter) editor.filter = undefined
          editor.focus = row
          editor.selectCaret(row, row.text.string.length)
        })
        editor.activate()
        break
      }
      case 'copyLink':
        // Only rows that already have a persistent id; copying never writes to the file.
        if (row.persistentId) bike.clipboard.writeText(row.url().absoluteString)
        break
    }
  }
}

// ---------------------------------------------------------------------------
// Count badges. Badges read values off the row, so the count comes from the
// index by persistent id, and the badge re-registers when counts change.

let badge: Disposable | undefined
let badgeSignature = ''
let counts = new Map<string, number>()

function updateBadges() {
  const next = new Map<string, number>()
  if (bike.defaults.get('showBadges') !== false) {
    for (const index of indexes.values()) {
      for (const links of index.all().values()) {
        const pid = links[0].target.persistentId
        if (pid) next.set(pid, (next.get(pid) ?? 0) + links.length)
      }
    }
  }
  const signature = [...next.entries()].sort().map(([k, n]) => `${k}=${n}`).join('|')
  if (signature === badgeSignature) return
  badgeSignature = signature
  counts = next
  badge?.dispose()
  badge = undefined
  if (counts.size === 0) return
  badge = bike.badge(BADGE, {
    where: '.@id',
    inputs: { pid: '@id' },
    render: (values, env) => {
      const n = values['pid'] ? counts.get(values['pid']) : undefined
      if (!n) return null
      // One image, so other badges (like a task pie chart) can't land between the arrow and the count.
      const color = env.color.alphaSet(0.55)
      const icon = Image.fromSymbol(new SymbolConfiguration('arrow.uturn.backward').withHierarchicalColor(color).withFont(env.font))
      const count = Image.fromText(new Text(String(n), env.font, color))
      return icon.withHStack(count, 2).withBackground({
        fill: env.color.alphaSet(0.08),
        cornerRadius: 5,
        padding: new Insets(1, 5, 1, 4),
      })
    },
    onClick: ({ editor, row }) => showBadgeMenu(editor, row),
  })
}

/** Clicking a badge lists the linking rows in a native menu. */
function showBadgeMenu(editor: OutlineEditor, row: Row) {
  const index = indexFor(editor.outline)
  if (!index) return
  const links = sortLinks(index.linksTo(row))
  if (links.length === 0) return
  const items: MenuItem[] = links.map((link, i) => ({
    type: 'button',
    id: `go:${i}`,
    title: clip(link.source.text.string, 70),
  }))
  editor.showMenu(
    { row, anchor: BADGE },
    {
      items,
      onAction: (id) => {
        const link = links[Number(id.slice(3))]
        if (link) goTo(editor, link.source, link.start, true)
      },
    }
  )
}

// ---------------------------------------------------------------------------
// Commands.

async function goToBacklinkCommand(context: CommandContext): Promise<void> {
  const editor = context.editor
  const row = editor?.selection?.row
  const index = editor && indexFor(editor.outline)
  if (!editor || !row || !index) return
  const links = sortLinks(index.linksTo(row))
  if (links.length === 0) {
    editor.showStatusMessage('No backlinks', 2)
    return
  }
  const items: ChoiceBoxItem[] = links.map((l) => ({
    name: clip(l.source.text.string, 90),
    container: l.source.parent && l.source.parent.id !== editor.outline.root.id ? clip(l.source.parent.text.string, 40) : undefined,
    symbol: 'arrow.uturn.backward',
  }))
  const window = bike.windows.find((w) => w.outlineEditors.includes(editor))
  const result = await bike.showChoiceBox({ placeholder: 'Go to backlink', items }, window)
  const link = result ? links[result.indices[0]] : undefined
  if (link) goTo(editor, link.source, link.start, true)
}

// ---------------------------------------------------------------------------

export async function activate(_context: AppExtensionContext) {
  bike.defaults.registerDefaults(backlinksDefaults)

  bike.commands.addCommands({
    commands: {
      'backlinks:go-to-backlink': (context) => {
        void goToBacklinkCommand(context)
        return true
      },
      'backlinks:toggle-count-badges': () => {
        bike.defaults.set('showBadges', bike.defaults.get('showBadges') === false)
        badgeSignature = '\u0000' // force re-registration
        updateBadges()
        return true
      },
    },
  })

  bike.observeDocuments((doc) => {
    const outline = doc.outline
    indexFor(outline)
    // A reload swaps the outline under the document; rebuild from the new one.
    const reload = outline.observeChanges((change) => {
      if (change.type !== 'reload') return
      dropIndex(change.oldOutline)
      indexFor(change.newOutline)
      pushAll()
      updateBadges()
    })
    doc.onClose(() => {
      reload.dispose()
      dropIndex(outline)
      updateBadges()
    })
    updateBadges()
  })

  bike.observeWindows(async (window: Window) => {
    const v: View = { window, shown: new Set() }
    views.set(window, v)

    window.observeCurrentOutlineEditor((editor) => {
      v.selection?.dispose()
      v.selection = editor?.observeSelection(() => push(v), 120)
      push(v)
    })

    const handle = await window.inspector.addItem<BacklinksProtocol>({ label: 'Backlinks', script: 'Backlinks.js' })
    v.handle = handle
    wire(v, handle)

    window.onClose(() => {
      v.selection?.dispose()
      views.delete(window)
    })
  })
}
