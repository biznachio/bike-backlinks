import { DOMExtensionContext } from 'bike/dom'
import { Disclosure, SFSymbol } from 'bike/components'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { BacklinkItem, BacklinksProtocol, BacklinksState, InsideGroup, OutLink, RowRef, STRIP_LABELS, StripLabel } from './protocol'
import { bestDate, dateOf, DateRef, keyOf, loadCreated, stillMissing } from './dates'
import './backlinks.css'

const MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
const WEEKS = 12
const NOTES_SHOWN = 2
const DATE_WAIT_MS = 300

const sameRef = (a?: RowRef | null, b?: RowRef | null) => !!a && !!b && a.outline === b.outline && a.row === b.row
const refKey = (r: RowRef) => `${r.outline}:${r.row}`

/** AP style: "Oct. 1", with the year when it isn't this year. */
function apDate(key: string): string {
  const d = dateOf(key)
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

function ago(key: string): string {
  const today = dateOf(keyOf(new Date()))
  const days = Math.round((today.getTime() - dateOf(key).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `on ${apDate(key)}`
}

/** Refs whose created dates the view needs: everything without a calendar day. */
function neededDates(state: BacklinksState): DateRef[] {
  const refs: DateRef[] = state.here.filter((i) => !i.day).map((i) => ({ row: i.ref.row, pid: i.pid, seen: i.seen }))
  for (const g of state.inside) refs.push(...g.undated)
  for (const o of state.out) refs.push(...o.undated)
  return refs
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])
}

export function BacklinksView({ context }: { context: DOMExtensionContext<BacklinksProtocol> }) {
  const [state, setState] = useState<BacklinksState>({ target: null, here: [], out: [], inside: [] })
  const [, setDatesVersion] = useState(0)
  const [openDays, setOpenDays] = useState<Set<string> | null>(null) // null: newest day open
  const [moreOpen, setMoreOpen] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<{ ref: RowRef; text: string }[]>([])
  const [toast, setToast] = useState('')
  // Remembered across launches and shared by every window.
  const [stripLabel, setStripLabel] = useState<StripLabel>(() => {
    const v = bike.defaults.get('stripLabel')
    return STRIP_LABELS.includes(v as StripLabel) ? (v as StripLabel) : 'weeks'
  })
  const lastTarget = useRef<RowRef | null>(null)
  const seq = useRef(0)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    context.onmessage = async (message) => {
      if (message.type !== 'state') return
      const next = message.state
      const n = ++seq.current
      if (retry.current) clearTimeout(retry.current)
      const outline = next.target?.ref.outline
      const needed = outline ? neededDates(next) : []
      if (outline && needed.length > 0) {
        // Hold the new state briefly so dated rows land on the thread without a flicker.
        const load = loadCreated(outline, needed)
        await withTimeout(load, DATE_WAIT_MS)
        load.then((changed) => changed && setDatesVersion((v) => v + 1))
        if (n !== seq.current) return
        // A brand-new row may not have its created date yet. Ask again a few times.
        const delays = [5_000, 15_000, 45_000]
        const again = (i: number) => {
          retry.current = setTimeout(async () => {
            if (n !== seq.current) return
            const missing = stillMissing(outline, needed)
            if (missing.length === 0) return
            if (await loadCreated(outline, missing)) setDatesVersion((v) => v + 1)
            if (i + 1 < delays.length) again(i + 1)
          }, delays[i])
        }
        again(0)
      }
      const target = next.target?.ref ?? null
      if (!sameRef(target, lastTarget.current)) {
        setOpenDays(null)
        setMoreOpen(new Set())
      }
      lastTarget.current = target
      if (target) {
        setHistory((h) => {
          let end = h.length
          while (end > 0 && sameRef(h[end - 1].ref, target)) end--
          return end === h.length ? h : h.slice(0, end)
        })
      }
      setState(next)
    }
    context.postMessage({ type: 'ready' })
    return () => {
      context.onmessage = undefined
    }
  }, [context])

  useEffect(() => {
    const sub = bike.defaults.observe('stripLabel', (v) => {
      if (STRIP_LABELS.includes(v as StripLabel)) setStripLabel(v as StripLabel)
    })
    return () => sub.dispose()
  }, [])

  function cycleStripLabel() {
    const next = STRIP_LABELS[(STRIP_LABELS.indexOf(stripLabel) + 1) % STRIP_LABELS.length]
    setStripLabel(next)
    bike.defaults.set('stripLabel', next)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1500)
    return () => clearTimeout(t)
  }, [toast])

  const { target, here, out, inside } = state
  const outline = target?.ref.outline ?? ''
  const dateFor = (i: BacklinkItem) => i.day ?? bestDate(outline, { row: i.ref.row, pid: i.pid, seen: i.seen })

  function go(ref: RowRef, char = 0) {
    if (target && !sameRef(ref, target.ref)) setHistory((h) => [...h, target])
    context.postMessage({ type: 'go', ref, char })
  }

  function goBack() {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    context.postMessage({ type: 'go', ref: prev.ref, char: 0 })
  }

  function toggle(set: Set<string>, key: string, update: (s: Set<string>) => void) {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    update(next)
  }

  // --- Thread data: newest dates first, undated last ---------------------

  const dated = here.map((item) => ({ item, date: dateFor(item) }))
  const sorted = [...dated].sort((a, b) => {
    if (a.date === b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? 1 : -1
  })
  const days: { date: string; items: BacklinkItem[]; calendar: boolean }[] = []
  for (const { item, date } of sorted) {
    const last = days[days.length - 1]
    if (last && last.date === date) {
      last.items.push(item)
      last.calendar = last.calendar && !!item.day
    } else {
      days.push({ date, items: [item], calendar: !!item.day })
    }
  }
  const open = openDays ?? new Set(days.length ? [days[0].date] : [])
  const latest = days.find((d) => d.date)?.date
  const allOpen = days.length > 0 && days.every((d) => open.has(d.date))

  // --- Pieces ------------------------------------------------------------

  // --- Shared pieces: one section header, one row, one count pill --------

  /** The same arrow-and-count pill as the outline badge. */
  const pill = (n: number) => (
    <span className="bl-pill" title={`${n} ${n === 1 ? 'backlink' : 'backlinks'}`}>
      <SFSymbol name="arrow.uturn.backward" scale="small" />
      {n}
    </span>
  )

  const section = (title: string, count: number, children: ReactNode, action?: ReactNode) => (
    <section className="bl-sec">
      <header className="bl-sech">
        <h3>
          {title}
          <span className="bl-sec-n">{count}</span>
        </h3>
        {action}
      </header>
      {children}
    </section>
  )

  const latestOf = (day: string | undefined, undated: DateRef[]) => {
    let best = day ?? ''
    for (const u of undated) {
      const d = bestDate(outline, u)
      if (d && d > best) best = d
    }
    return best
  }

  /** A row that leads somewhere: name, one meta line, count pill. */
  const navRow = (key: string, name: string, meta: string, count: number, onClick: () => void, title?: string, share?: number) => (
    <button key={key} className="bl-row bl-nav-row" title={title ?? `Go to ${name}`} onClick={onClick}>
      <span className="bl-rtext">
        <span className="bl-t">{name}</span>
        {meta && <span className="bl-m footnote">{meta}</span>}
        {share !== undefined && (
          <span className="bl-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(4, share * 100)}%` }} />
          </span>
        )}
      </span>
      {pill(count)}
    </button>
  )

  // --- Header: name, one summary line, activity strip ---------------------

  const summary = () => {
    const parts: string[] = []
    if (here.length) parts.push(`${here.length} ${here.length === 1 ? 'backlink' : 'backlinks'}${latest ? `, latest ${ago(latest)}` : ''}`)
    else if (inside.length) {
      const total = inside.reduce((t, g) => t + g.count, 0)
      parts.push(`No direct backlinks. ${total} ${total === 1 ? 'link' : 'links'} to rows inside`)
    } else parts.push('No backlinks yet')
    return parts.join('') + '.'
  }

  const rhythm = () => {
    const today = dateOf(keyOf(new Date()))
    const weeks: number[] = new Array(WEEKS).fill(0)
    for (const { date } of dated) {
      if (!date) continue
      const w = Math.floor((today.getTime() - dateOf(date).getTime()) / (7 * 86_400_000))
      if (w >= 0 && w < WEEKS) weeks[WEEKS - 1 - w]++
    }
    const start = new Date(today.getTime() - (WEEKS - 1) * 7 * 86_400_000)
    return (
      <div className="bl-strip">
        <div className="bl-rhythm" role="img" aria-label={`Backlinks per week over the last ${WEEKS} weeks`}>
          {weeks.map((n, i) => (
            <span key={i} className={`bl-cell${n ? ` bl-on${Math.min(n, 3)}` : ''}`} title={`${n} ${n === 1 ? 'backlink' : 'backlinks'}`} />
          ))}
        </div>
        <div className="bl-rlabels footnote">
          <button className="bl-start" title="Click to change how the start is shown" onClick={cycleStripLabel}>
            {stripLabel === 'weeks' ? `${WEEKS} weeks ago` : stripLabel === 'months' ? `${Math.round(WEEKS / 4.345)} months ago` : apDate(keyOf(start))}
          </button>
          <span>This week</span>
        </div>
      </div>
    )
  }

  // --- Linked from: the thread --------------------------------------------

  const entry = (item: BacklinkItem) => {
    const key = refKey(item.ref)
    const expanded = moreOpen.has(key)
    const notes = expanded ? item.notes : item.notes.slice(0, NOTES_SHOWN)
    const hidden = Math.max(0, item.notes.length - NOTES_SHOWN)
    return (
      <div
        key={key}
        className="bl-row bl-entry"
        tabIndex={0}
        title="Open in outline"
        onClick={() => go(item.ref, item.char)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) go(item.ref, item.char)
        }}
      >
        <div className="bl-acts" onClick={(e) => e.stopPropagation()}>
          <button className="bl-act" title="Open" aria-label="Open" onClick={() => go(item.ref, item.char)}>
            <SFSymbol name="arrow.up.right" scale="small" />
          </button>
          <button className="bl-act" title="Focus on this row in the outline" aria-label="Focus" onClick={() => {
              if (target && !sameRef(item.ref, target.ref)) setHistory((h) => [...h, target])
              context.postMessage({ type: 'focus', ref: item.ref })
            }}>
            <SFSymbol name="arrow.down.right" scale="small" />
          </button>
          <button
            className="bl-act"
            disabled={!item.linkable}
            title={item.linkable ? 'Copy link to this row' : 'This row has no link yet'}
            aria-label="Copy link"
            onClick={() => {
              context.postMessage({ type: 'copyLink', ref: item.ref })
              setToast('Link copied')
            }}
          >
            <SFSymbol name="link" scale="small" />
          </button>
        </div>
        <div className="bl-t bl-say">
          {item.excerpt.before}
          <mark>{item.excerpt.link}</mark>
          {item.excerpt.after}
        </div>
        {item.where && <div className="bl-m footnote">{item.where}</div>}
        {notes.length > 0 && (
          <ul className="bl-notes footnote">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {hidden + item.more > 0 && (
          <button
            className="bl-link footnote"
            onClick={(e) => {
              e.stopPropagation()
              toggle(moreOpen, key, setMoreOpen)
            }}
          >
            {expanded ? 'Show less' : `Show ${hidden + item.more} more`}
          </button>
        )}
        {expanded && item.more > 0 && <div className="bl-m footnote">{item.more} more in the outline</div>}
      </div>
    )
  }

  const thread = () => (
    <div className="bl-thread">
      {days.map((d) => {
        const isOpen = open.has(d.date)
        const label = d.date ? apDate(d.date) : 'Undated'
        return (
          <div key={d.date || 'undated'}>
            <button
              className={`bl-day${d.calendar ? '' : ' bl-proj'}${isOpen ? '' : ' bl-shut'}`}
              aria-expanded={isOpen}
              title={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
              onClick={() => toggle(open, d.date, setOpenDays)}
            >
              {label}
              <span className="bl-sec-n">{d.items.length}</span>
            </button>
            {isOpen && d.items.map(entry)}
          </div>
        )
      })}
    </div>
  )

  const expandAll =
    days.length > 1 ? (
      <button className="bl-link footnote" onClick={() => setOpenDays(allOpen ? new Set() : new Set(days.map((d) => d.date)))}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
    ) : undefined

  // --- Linked inside and Links to: the same row ----------------------------

  const linkedInside = () => {
    const rows = inside
      .map((g: InsideGroup) => ({ g, best: latestOf(g.day, g.undated) }))
      .sort((a, b) => b.g.count - a.g.count || (a.best < b.best ? 1 : a.best > b.best ? -1 : 0))
    const max = rows[0]?.g.count || 1
    return section(
      'Linked inside',
      rows.length,
      <div className="bl-list">
        {rows.map(({ g, best }) => navRow(refKey(g.ref), g.text, best ? `Latest ${apDate(best)}` : '', g.count, () => go(g.ref), undefined, g.count / max))}
      </div>
    )
  }

  const linksTo = () =>
    section(
      'Links to',
      out.length,
      <div className="bl-list">
        {out.map((o: OutLink) => {
          const best = latestOf(o.day, o.undated)
          const meta = [o.where, best ? `latest ${apDate(best)}` : ''].filter(Boolean).join(', ')
          return navRow(refKey(o.ref), o.text, meta, o.count, () => go(o.ref), o.via ? `From a note inside: ${o.via}` : undefined)
        })}
      </div>
    )

  // --- Layout -------------------------------------------------------------

  let body
  if (!target) {
    body = <p className="bl-summary">Select a row to see what links to it.</p>
  } else {
    const prev = history[history.length - 1]
    body = (
      <>
        {prev && (
          <div className="bl-nav">
            <button className="bl-back" title={`Back to ${prev.text}`} aria-label={`Back to ${prev.text}`} onClick={goBack}>
              <SFSymbol name="chevron.left" weight="semibold" scale="small" />
              <span>{prev.text || 'Previous row'}</span>
            </button>
          </div>
        )}
        <div className="bl-head">
          <div className="bl-who">{target.text || 'Untitled row'}</div>
          <p className="bl-summary">{summary()}</p>
          {here.length > 0 && rhythm()}
        </div>
        {here.length > 0 && section('Linked from', here.length, thread(), expandAll)}
        {here.length === 0 && inside.length > 0 && linkedInside()}
        {out.length > 0 && linksTo()}
        {here.length === 0 && inside.length === 0 && out.length === 0 && (
          <p className="bl-hint footnote">
            To link here from a note, place your cursor in it and choose <b>Format › Add Link to Row…</b> (⌥⌘K), then pick this row.
          </p>
        )}
      </>
    )
  }

  return (
    <div className="bl-root short-body">
      <Disclosure label="Backlinks" defaultExpanded>
        <div className="bl-body">{body}</div>
      </Disclosure>
      {toast && (
        <div className="bl-toast footnote" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
