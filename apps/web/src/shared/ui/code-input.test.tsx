import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeInput, type CodeAlphabet } from './code-input'

// Контролируемая обёртка: CodeInput сам состояние не держит, а тесты проверяют
// именно поведение при вводе, поэтому value хранит хост-компонент.
function Harness({
  length = 6,
  alphabet = 'numeric' as CodeAlphabet,
  onComplete,
}: {
  length?: number
  alphabet?: CodeAlphabet
  onComplete?: (v: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <>
      <CodeInput
        value={value}
        onChange={setValue}
        length={length}
        alphabet={alphabet}
        onComplete={onComplete}
        aria-label="Код"
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

const cells = (): HTMLInputElement[] => screen.getAllByRole('textbox') as HTMLInputElement[]

// Явный доступ к ячейке: под noUncheckedIndexedAccess индексация даёт `| undefined`,
// а в тесте отсутствие ячейки — сразу провал, а не тихий undefined.
const cell = (i: number): HTMLInputElement => {
  const el = cells()[i]
  if (!el) throw new Error(`нет ячейки с индексом ${i}`)
  return el
}
const current = (): string => screen.getByTestId('value').textContent ?? ''

describe('CodeInput', () => {
  it('рисует по ячейке на символ', () => {
    render(<Harness length={6} />)
    expect(cells()).toHaveLength(6)
  })

  it('ввод цифр заполняет ячейки и двигает фокус', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(cell(0))
    await user.keyboard('123')
    expect(current()).toBe('123')
    expect(cell(3)).toHaveFocus()
  })

  it('отбрасывает символы вне алфавита', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(cell(0))
    await user.keyboard('1a2b3')
    expect(current()).toBe('123')
  })

  it('вызывает onComplete один раз на полный код', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    await user.click(cell(0))
    await user.keyboard('603434')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('603434')
  })

  it('вставка из буфера раскладывается по ячейкам, разделители игнорируются', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(cell(0))
    await user.paste('603 434')
    expect(current()).toBe('603434')
  })

  it('автозаполнение целой строкой в одну ячейку раскладывается по ячейкам', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    // Менеджер паролей/SMS-autofill пишет весь код в первое поле одним событием.
    await user.type(cell(0), '603434')
    expect(current()).toBe('603434')
  })

  it('backspace стирает символ в ячейке, повторный — уходит влево', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(cell(0))
    await user.keyboard('12')
    await user.keyboard('{Backspace}')
    expect(current()).toBe('1')
    await user.keyboard('{Backspace}')
    expect(current()).toBe('')
    expect(cell(0)).toHaveFocus()
  })

  it('стрелки двигают фокус между ячейками', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(cell(0))
    await user.keyboard('{ArrowRight}')
    expect(cell(1)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(cell(0)).toHaveFocus()
  })

  it('hex-режим принимает буквы A–F и приводит к верхнему регистру', async () => {
    const user = userEvent.setup()
    render(<Harness length={8} alphabet="hex" />)
    await user.click(cell(0))
    await user.keyboard('3f9a2b7c')
    expect(current()).toBe('3F9A2B7C')
  })

  it('hex-режим отбрасывает буквы вне A–F', async () => {
    const user = userEvent.setup()
    render(<Harness length={8} alphabet="hex" />)
    await user.click(cell(0))
    await user.keyboard('3fzz9')
    expect(current()).toBe('3F9')
  })

  it('не принимает больше символов, чем ячеек', async () => {
    const user = userEvent.setup()
    render(<Harness length={6} />)
    await user.click(cell(0))
    await user.paste('12345678')
    expect(current()).toBe('123456')
  })

  it('каждая ячейка доступна по имени с позицией', () => {
    render(<Harness length={6} />)
    expect(screen.getByLabelText('Код 1/6')).toBeInTheDocument()
    expect(screen.getByLabelText('Код 6/6')).toBeInTheDocument()
  })
})
