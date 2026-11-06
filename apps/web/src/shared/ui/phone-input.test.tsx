import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhoneInput, isCompletePhone } from './phone-input'

// Контролируемая обёртка: значение держит хост, как в формах (Controller).
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PhoneInput aria-label="phone" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const value = () => screen.getByTestId('value').textContent

describe('PhoneInput — телефон Казахстана', () => {
  it('номер без кода страны — к +7', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('phone'), '7771234567')
    expect(value()).toBe('+7 (777) 123-45-67')
  })

  it('«8» вместо +7 — заменяется на +7', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('phone'), '87071234567')
    expect(value()).toBe('+7 (707) 123-45-67')
  })

  it('вставка номера целиком — в любом привычном виде', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('phone')
    await userEvent.click(input)
    await userEvent.paste('+7 701 234 56 78')
    expect(value()).toBe('+7 (701) 234-56-78')
  })

  it('стёртое поле — пустая строка, а не «+7»', async () => {
    render(<Harness initial="+7 (777) 123-45-67" />)
    await userEvent.clear(screen.getByLabelText('phone'))
    expect(value()).toBe('')
  })

  it('полнота номера', () => {
    expect(isCompletePhone('+7 (777) 123-45-67')).toBe(true)
    expect(isCompletePhone('+7 (777) 123-4')).toBe(false)
    expect(isCompletePhone('')).toBe(false)
  })
})
