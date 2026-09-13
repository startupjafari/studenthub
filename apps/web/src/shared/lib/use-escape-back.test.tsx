import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { backMock, state } = vi.hoisted(() => ({
  backMock: vi.fn(),
  state: { pathname: '/career' },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: backMock }),
  usePathname: () => state.pathname,
}))

import { useEscapeBack } from './use-escape-back'

function Probe() {
  useEscapeBack()
  return null
}

/** Перерисовка с новым путём = переход внутри приложения. */
function renderAfterNavigation() {
  state.pathname = '/career'
  const view = render(<Probe />)
  state.pathname = '/career/vacancies'
  view.rerender(<Probe />)
  return view
}

/**
 * Нажатие Esc и ожидание решения хука: оно отложено на макрозадачу, чтобы остальные
 * слушатели успели пометить событие обработанным.
 */
async function pressEscape(init: KeyboardEventInit = {}): Promise<void> {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  backMock.mockClear()
  document.body.innerHTML = ''
  // history.length в jsdom всегда 1 — подменяем, иначе проверка «есть куда возвращаться»
  // гасит переход во всех тестах.
  Object.defineProperty(window.history, 'length', { value: 5, configurable: true })
})

describe('useEscapeBack', () => {
  it('после перехода внутри приложения Esc возвращает назад', async () => {
    renderAfterNavigation()
    await pressEscape()
    expect(backMock).toHaveBeenCalledTimes(1)
  })

  it('на странице, открытой прямой ссылкой, Esc не уводит из приложения', async () => {
    render(<Probe />)
    await pressEscape()
    // Переходов внутри приложения не было — возвращаться некуда.
    expect(backMock).not.toHaveBeenCalled()
  })

  it('открытый диалог забирает Esc себе', async () => {
    renderAfterNavigation()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)

    await pressEscape()

    expect(backMock).not.toHaveBeenCalled()
  })

  it('свой слой с data-overlay тоже забирает Esc', async () => {
    renderAfterNavigation()
    const layer = document.createElement('div')
    layer.setAttribute('data-overlay', '')
    document.body.append(layer)

    await pressEscape()

    expect(backMock).not.toHaveBeenCalled()
  })

  it('из поля ввода первый Esc выводит фокус, а не уводит со страницы', async () => {
    renderAfterNavigation()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    await pressEscape()
    expect(backMock).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input)

    // Второй Esc — уже переход: поле отпущено, забирать нажатие некому.
    await pressEscape()
    expect(backMock).toHaveBeenCalledTimes(1)
  })

  it('Esc с модификатором не трогаем — это сочетание, а не отмена', async () => {
    renderAfterNavigation()
    await pressEscape({ shiftKey: true })
    expect(backMock).not.toHaveBeenCalled()
  })

  it('нажатие, уже обработанное кем-то, игнорируется', async () => {
    renderAfterNavigation()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(backMock).not.toHaveBeenCalled()
  })

  it('панель, подписавшаяся ПОЗЖЕ хука, всё равно забирает Esc себе', async () => {
    renderAfterNavigation()
    // Панель открывается после старта приложения, поэтому её слушатель всегда последний.
    // Именно этот случай ломал уведомления: панель закрывалась, а страница уезжала назад.
    const panel = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') e.preventDefault()
    }
    window.addEventListener('keydown', panel)

    await pressEscape()

    window.removeEventListener('keydown', panel)
    expect(backMock).not.toHaveBeenCalled()
  })
})
