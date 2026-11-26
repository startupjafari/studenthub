import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// next-intl → ключ: проверяем, какой текст выбран, а не перевод.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import { SecondFactorCodeField } from './second-factor-code-field'

// Хост держит значение и последний признак готовности — поле само его не хранит.
function Harness({ onComplete }: { onComplete?: (value: string) => void }) {
  const [value, setValue] = useState('')
  const [complete, setComplete] = useState(false)
  return (
    <>
      <SecondFactorCodeField
        id="code"
        value={value}
        onChange={(next, isComplete) => {
          setValue(next)
          setComplete(isComplete)
        }}
        onComplete={onComplete}
      />
      <output data-testid="state">{`${value}|${complete}`}</output>
    </>
  )
}

const cells = (): HTMLElement[] => screen.getAllByRole('textbox')

describe('SecondFactorCodeField', () => {
  it('код из приложения — шесть ячеек, готов на шестой цифре', async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    expect(screen.getByRole('group', { name: 'twoFactorCodeLabel' })).toBeInTheDocument()
    expect(cells()).toHaveLength(6)

    await userEvent.keyboard('12345')
    expect(screen.getByTestId('state')).toHaveTextContent('12345|false')

    await userEvent.keyboard('6')
    expect(screen.getByTestId('state')).toHaveTextContent('123456|true')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('резервный код — восемь hex-ячеек; переключение очищает введённое', async () => {
    render(<Harness />)
    await userEvent.keyboard('123')

    await userEvent.click(screen.getByRole('button', { name: 'twoFactorBackupHint' }))

    expect(screen.getByRole('group', { name: 'twoFactorBackupCodeLabel' })).toBeInTheDocument()
    expect(cells()).toHaveLength(8)
    expect(screen.getByTestId('state')).toHaveTextContent('|false')

    // Шесть символов резервного кода — ещё не код: готовность считается по длине режима.
    await userEvent.click(cells()[0]!)
    await userEvent.keyboard('123456')
    expect(screen.getByTestId('state')).toHaveTextContent('123456|false')
    await userEvent.keyboard('ab')
    expect(screen.getByTestId('state')).toHaveTextContent('123456AB|true')

    await userEvent.click(screen.getByRole('button', { name: 'twoFactorUseAppHint' }))
    expect(cells()).toHaveLength(6)
  })
})
