import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../entities/user', () => ({
  ProfileLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { MessageGroupAvatar } from './message-group-avatar'

const sender = {
  id: 'u1',
  firstName: 'Аня',
  lastName: 'Ким',
  avatarUrl: null,
} as unknown as Parameters<typeof MessageGroupAvatar>[0]['sender']

describe('MessageGroupAvatar', () => {
  const log: string[] = []
  let restoreRect: () => void

  beforeEach(() => {
    log.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const orig = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      log.push(`read:${this.id || this.tagName}`)
      // Первое сообщение серии на 300 px выше аватара.
      const top = this.id.startsWith('msg-') ? 100 : 400
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect
    }
    restoreRect = () => {
      HTMLElement.prototype.getBoundingClientRect = orig
    }
  })

  afterEach(() => {
    restoreRect()
    vi.unstubAllGlobals()
  })

  it('тянет колонку до первого сообщения серии и ставит аватар над панелью ввода', async () => {
    const { container } = render(
      <div data-message-scroller="" style={{ paddingBottom: '64px' }}>
        <div id="msg-a" />
        <div id="msg-b" />
        <MessageGroupAvatar sender={sender} runStartId="a" />
        <MessageGroupAvatar sender={sender} runStartId="b" />
      </div>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    const columns = container.querySelectorAll<HTMLElement>('span.pointer-events-none')
    const sticks = container.querySelectorAll<HTMLElement>('span.sticky')
    expect(columns).toHaveLength(2)
    for (const c of columns) expect(c.style.top).toBe('-300px')
    for (const s of sticks) expect(s.style.bottom).toBe('64px')
    // Оба аватара замерены одной пачкой: все чтения геометрии раньше любой записи.
    expect(log.filter((l) => l.startsWith('read:msg-'))).toEqual(['read:msg-a', 'read:msg-b'])
  })
})
