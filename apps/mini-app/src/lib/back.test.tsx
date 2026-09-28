import { render } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const close = vi.fn()
vi.mock('../telegram/webapp', () => ({ webApp: () => ({ close }) }))

import { goBack, useBackHandler } from './back'

// Возврат один на всё приложение, и вся его логика — в том, что он делает, когда
// возвращаться некуда. Ошибиться здесь дорого в обе стороны: лишний выход закрывает
// мини-апп посреди работы, а недостающий оставляет человека на экране без выхода.

function Screen({ onBack }: { onBack: () => void }) {
  useBackHandler(onBack)
  return null
}

describe('стек возврата', () => {
  beforeEach(() => vi.clearAllMocks())

  it('без открытых экранов закрывает мини-апп', () => {
    goBack()
    expect(close).toHaveBeenCalled()
  })

  it('с открытым экраном возвращает, а не закрывает', () => {
    const back = vi.fn()
    render(<Screen onBack={back} />)

    goBack()

    expect(back).toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  // Экраны вкладываются: очередь → жалоба, обращение → переписка. Уходят всегда с
  // самого глубокого.
  it('из вложенных экранов уводит верхний', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<Screen onBack={outer} />)
    render(<Screen onBack={inner} />)

    goBack()

    expect(inner).toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
  })

  // Обработчик снимается сам вместе с экраном — иначе после возврата в корень кнопка
  // продолжала бы звать обработчик экрана, которого уже нет.
  it('закрытый экран перестаёт держать возврат', () => {
    const back = vi.fn()
    const screen = render(<Screen onBack={back} />)
    screen.unmount()

    goBack()

    expect(back).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})
