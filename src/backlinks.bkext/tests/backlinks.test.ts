import { Row } from 'bike/app'
import { apDate, dayFromId, displayLinkText, makeExcerpt, rowRefFromURL } from '../dom/lib/format'
import { OutlineIndex } from '../app/index'
import { buildState } from '../app/present'

describe('format helpers', () => {
  it('reads calendar day ids and skips month and year rows', () => {
    assert.equal(JSON.stringify(dayFromId('2026/10/01')), JSON.stringify({ year: 2026, month: 10, day: 1 }))
    assert.equal(dayFromId('2026/10/00'), null)
    assert.equal(dayFromId('2026/00/00'), null)
    assert.equal(dayFromId('4D2gjsIU7FCcuHZA_rge_'), null)
  })

  it('writes AP dates', () => {
    assert.equal(apDate({ year: 2026, month: 10, day: 1 }, 2026), 'Oct. 1')
    assert.equal(apDate({ year: 2025, month: 3, day: 4 }, 2026), 'March 4, 2025')
  })

  it('names the target when link text is only a URL', () => {
    assert.equal(displayLinkText('bike://abc/#xyz', 'Ada Lovelace'), 'Ada Lovelace')
    assert.equal(displayLinkText('Ada', 'Ada Lovelace'), 'Ada')
  })

  it('centers excerpts on the link', () => {
    const text = 'I need to ask Ada Lovelace and Grace Hopper to review the quarterly plan'
    const e = makeExcerpt(text, 31, 43, 'Grace Hopper')
    assert(e.before.startsWith('…'), 'long lead-in is trimmed')
    assert.equal(e.link, 'Grace Hopper')
  })

  it('reads the row from a bike URL', () => {
    assert.equal(rowRefFromURL('/', 'abc'), 'abc')
    assert.equal(rowRefFromURL('/abc', undefined), 'abc')
    assert.equal(rowRefFromURL('/', '2026%2F10%2F01'), '2026/10/01')
  })
})

describe('OutlineIndex', () => {
  const editor = bike.testEditor()
  const outline = editor.outline
  let target: Row
  let people: Row

  it('sets up linked rows', () => {
    outline.root.ensurePersistentId()
    outline.transaction({ label: 'setup' }, () => {
      people = outline.insertRows(['People'], outline.root)[0]
      target = outline.insertRows([{ persistentId: 'ada', text: 'Ada' }], people)[0]
      outline.insertRows(
        [
          { text: 'Met with [Ada](#ada) today', format: 'markdown' },
          { text: '[Ada](#ada) and [Ada](#ada) again', format: 'markdown' },
          { persistentId: 'self', text: 'A [self link](#self)', format: 'markdown' },
          { text: 'A [web link](https://example.com)', format: 'markdown' },
        ],
        outline.root
      )
    })
    assert.equal(target.persistentId, 'ada')
  })

  it('finds each linking row once, ignoring self and web links', () => {
    const index = new OutlineIndex(outline)
    assert.equal(index.linksTo(target).length, 2)
    index.dispose()
  })

  it('rolls links up to the parent', () => {
    const index = new OutlineIndex(outline)
    const { state, shown } = buildState(index, people)
    assert.equal(state.here.length, 0)
    assert.equal(state.inside.length, 1)
    assert.equal(state.inside[0].count, 2)
    assert(shown.has(target.id), 'the rollup target counts as shown')
    assert.equal(state.inside[0].undated.length, 2, 'undated backlinks are listed for created-date lookup')
    index.dispose()
  })

  it('lists where a row links to, including notes inside it', () => {
    const index = new OutlineIndex(outline)
    const meeting = outline.insertRows(['Weekly sync'], outline.root)[0]
    outline.insertRows([{ text: 'Ask [Ada](#ada) about it', format: 'markdown' }], meeting)
    const { state } = buildState(index, meeting)
    assert.equal(state.out.length, 1)
    assert.equal(state.out[0].inside, true)
    assert.equal(state.here.length, 0)
    index.dispose()
  })

  it('reports a plain text edit as touched, not as a link change', async () => {
    const index = new OutlineIndex(outline)
    const change = await new Promise<{ linksChanged: boolean; touched: Set<number> }>((resolve) => {
      index.onChange(resolve)
      outline.transaction({ label: 'edit' }, () => {
        const text = people.text
        text.insert(text.count, 's')
        people.text = text
      })
    })
    assert.equal(change.linksChanged, false)
    assert(change.touched.has(people.id), 'edited row is touched')
    index.dispose()
  })

  it('never writes to the outline', () => {
    const before = outline.archive().data
    const index = new OutlineIndex(outline)
    buildState(index, target)
    buildState(index, people)
    assert.equal(outline.archive().data, before)
    index.dispose()
  })
})
