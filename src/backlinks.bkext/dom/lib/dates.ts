// Created dates, read through Bike's session API. DOM context only.

/** Created dates never change, so cache them for the life of the inspector. */
const cache = new Map<string, string>() // `${outline}:${id or pid}` -> YYYYMMDD, or '' when unknown

const pad = (n: number) => String(n).padStart(2, '0')

export function keyOf(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

export function dateOf(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)))
}

/** Bike reports ISO strings; numeric seconds are handled defensively. */
function parseCreated(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    let n = Number(value)
    if (n > 1e12) n = n / 1000 // milliseconds
    else if (n < 9e8) n = n + 978307200 // seconds since 2001, Apple's reference date
    return keyOf(new Date(n * 1000))
  }
  const t = Date.parse(String(value))
  return Number.isNaN(t) ? '' : keyOf(new Date(t))
}

export type DateRef = { row: number; pid?: string; seen?: string }

const misses = new Map<string, number>()
const RETRY_MS = 4_000

export function cachedDate(outline: string, ref: DateRef): string | undefined {
  return cache.get(`${outline}:${ref.row}`) ?? (ref.pid ? cache.get(`${outline}:${ref.pid}`) : undefined)
}

function recentlyMissed(outline: string, ref: DateRef): boolean {
  const t = misses.get(`${outline}:${ref.row}`)
  return t !== undefined && Date.now() - t < RETRY_MS
}

/** Fetch created dates for rows not yet cached, in one request. Resolves true when anything new arrived. */
export async function loadCreated(outline: string, refs: DateRef[]): Promise<boolean> {
  const missing = refs.filter((r) => cachedDate(outline, r) === undefined && !recentlyMissed(outline, r))
  if (missing.length === 0) return false
  const record = (row: { id?: unknown; persistentId?: string; created?: unknown }) => {
    const day = parseCreated(row.created)
    if (!day) return // a blank is not an answer; ask again later
    if (typeof row.id === 'number') {
      cache.set(`${outline}:${row.id}`, day)
      cache.set(`${outline}:${row.id >>> 0}`, day) // signed and unsigned spellings name one row
    }
    if (row.persistentId) cache.set(`${outline}:${row.persistentId}`, day)
  }
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if ('created' in node) record(node)
    for (const child of node.children ?? []) walk(child)
    for (const row of node.rows ?? []) walk(row)
  }
  // Rows with a persistent id are addressed by it; it survives anything the session id doesn't.
  const rowRefs = missing.map((r) => r.pid ?? r.row)
  const attempts: (() => Promise<unknown>)[] = [
    () => bike.session.getOutline({ rowRefs, shape: 'flat' }), // this inspector's window
    () => bike.session.getOutline({ outline, rowRefs, shape: 'flat' }),
  ]
  for (const attempt of attempts) {
    try {
      const doc: any = await attempt()
      walk(doc?.root)
      walk(doc)
      if (missing.some((r) => cachedDate(outline, r))) break
    } catch (error) {
      console.warn('Backlinks: could not read created dates', error)
    }
  }
  if (!missing.some((r) => cachedDate(outline, r))) {
    console.warn(`Backlinks: no created dates returned for ${missing.length} rows. Is Bike's row date setting on?`)
  }
  // Remember misses briefly, so a later fix (like turning the setting on) is picked up.
  for (const r of missing) if (cachedDate(outline, r) === undefined) misses.set(`${outline}:${r.row}`, Date.now())
  return true
}

/** The best date for a row: its created date, else the day its link appeared this session. */
export function bestDate(outline: string, ref: DateRef): string {
  return cachedDate(outline, ref) || ref.seen || ''
}

/** True when some refs still lack a created date and may be worth asking about again. */
export function stillMissing(outline: string, refs: DateRef[]): DateRef[] {
  return refs.filter((r) => !cachedDate(outline, r))
}
