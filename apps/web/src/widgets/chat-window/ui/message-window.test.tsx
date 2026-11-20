import { createRef, type RefObject } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MessageWindow, type MessageWindowHandle } from './message-window'

// В jsdom нет раскладки: высоты строк, offsetTop и прокрутку контейнера подставляем сами.
// Строка — блок фиксированной высоты (HEIGHT), строки идут подряд без зазоров.
const HEIGHT = 100
const VIEW = 300

function fakeScroller(): { el: HTMLDivElement; ref: RefObject<HTMLDivElement | null> } {
  const el = document.createElement('div')
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      const max = Math.max(0, el.scrollHeight - VIEW)
      top = Math.min(Math.max(0, v), max)
    },
  })
  Object.defineProperty(el, 'clientHeight', { get: () => VIEW })
  Object.defineProperty(el, 'scrollHeight', {
    get: () => el.querySelectorAll('[data-window-key]').length * HEIGHT,
  })
  el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  document.body.appendChild(el)
  return { el, ref: { current: el } }
}

let originalOffsetTop: PropertyDescriptor | undefined
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
let scroller: ReturnType<typeof fakeScroller>

beforeEach(() => {
  originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
  originalRect = HTMLElement.prototype.getBoundingClientRect
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const parent = this.parentElement
      if (!this.hasAttribute('data-window-key') || !parent) return 0
      return Array.prototype.indexOf.call(parent.children, this) * HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => HEIGHT,
  })
  scroller = fakeScroller()
  // Содержимое ленты едет вверх вместе с прокруткой.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this === scroller.el) return { top: 0 } as DOMRect
    return { top: -scroller.el.scrollTop } as DOMRect
  }
})

afterEach(() => {
  if (originalOffsetTop)
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop)
  HTMLElement.prototype.getBoundingClientRect = originalRect
  scroller.el.remove()
})

function List({
  ids,
  handle,
  stick = () => false,
}: {
  ids: string[]
  handle?: RefObject<MessageWindowHandle | null>
  stick?: () => boolean
}) {
  return (
    <MessageWindow ref={handle} scrollRef={scroller.ref} stickToBottom={stick}>
      {ids.map((id) => (
        <p key={id}>{id}</p>
      ))}
    </MessageWindow>
  )
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `m${from + i}`)

function mount(ids: string[], stick?: () => boolean) {
  const handle = createRef<MessageWindowHandle>()
  const r = render(<List ids={ids} handle={handle} stick={stick} />, {
    container: scroller.el,
  })
  return { ...r, handle }
}

function scrollTo(top: number) {
  act(() => {
    scroller.el.scrollTop = top
    scroller.el.dispatchEvent(new Event('scroll'))
  })
}

describe('MessageWindow: якорь ленты', () => {
  it('догрузка истории сверху не сдвигает то, что в кадре', () => {
    const { rerender } = mount(range(10, 20))
    scrollTo(250) // в кадре m12 (верх −50px), m13, m14
    rerender(<List ids={range(0, 20)} />)
    // Сверху добавилось 10 строк по 100px — лента уехала на 1000px, кадр тот же.
    expect(scroller.el.scrollTop).toBe(1250)
  })

  it('обрезка окна сверху тоже не сдвигает кадр', () => {
    const { rerender } = mount(range(0, 20))
    scrollTo(1250)
    rerender(<List ids={range(5, 20)} />)
    expect(scroller.el.scrollTop).toBe(750)
  })

  it('новое сообщение снизу не трогает прокрутку читающего историю', () => {
    const { rerender } = mount(range(0, 20))
    scrollTo(400)
    rerender(<List ids={range(0, 21)} />)
    expect(scroller.el.scrollTop).toBe(400)
  })

  it('стоящего внизу окно держит внизу, когда лента растёт не за счёт нового сообщения', () => {
    let stick = false
    const { rerender } = mount(range(5, 20), () => stick)
    scrollTo(1200) // самый низ: 15 строк × 100 − 300
    stick = true
    rerender(<List ids={range(0, 20)} stick={() => stick} />)
    expect(scroller.el.scrollTop).toBe(2000 - VIEW)
  })

  it('замеры и прокрутка к строке через handle', () => {
    const { handle } = mount(range(0, 20))
    scrollTo(450)
    const h = handle.current
    expect(h).not.toBeNull()
    expect(h?.scrollOffset).toBe(450)
    expect(h?.findItemIndex(450)).toBe(4)
    expect(h?.getItemOffset(7)).toBe(700)
    act(() => h?.scrollToIndex(10, { align: 'start' }))
    expect(scroller.el.scrollTop).toBe(1000)
    act(() => h?.scrollToIndex(19, { align: 'end' }))
    expect(scroller.el.scrollTop).toBe(2000 - VIEW)
    act(() => h?.scrollToIndex(3, { align: 'center' }))
    expect(scroller.el.scrollTop).toBe(200)
  })
})
