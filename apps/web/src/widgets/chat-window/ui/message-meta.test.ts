import { describe, expect, it } from 'vitest'
import { metaSpacerStyle } from './message-meta'

const base = {
  time: '03:16',
  editedLabel: null,
  pinned: false,
  mine: false,
  readState: 'sent' as const,
  readCount: 0,
}
const pad = (style: Record<string, unknown>) => parseFloat(String(style['--meta-pad']))

describe('metaSpacerStyle', () => {
  it('распорка повторяет текст меты', () => {
    expect(metaSpacerStyle(base)['--meta-text' as never]).toBe('"03:16"')
    expect(metaSpacerStyle({ ...base, editedLabel: 'изм.' })['--meta-text' as never]).toBe(
      '"изм. 03:16"',
    )
  })

  it('место под галочки и число прочитавших растёт с числом цифр', () => {
    const own = pad(metaSpacerStyle({ ...base, mine: true }) as never)
    const read = pad(
      metaSpacerStyle({ ...base, mine: true, readState: 'read', readCount: 18 }) as never,
    )
    expect(own).toBeGreaterThan(pad(metaSpacerStyle(base) as never))
    // «18» при шрифте 12 px — около 16 px вместе с зазором: время не налезает на текст.
    expect(read - own).toBeGreaterThanOrEqual(1)
  })
})
