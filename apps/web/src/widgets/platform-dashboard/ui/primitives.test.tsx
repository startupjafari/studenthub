import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityGrid, ChartLegend, Meter, StatTile } from './primitives'
import { chartPalette } from '../../../shared/ui/chart'

const palette = chartPalette(false)

describe('ChartLegend', () => {
  const items = [
    { key: 'students', label: 'Студенты', color: '#2a78d6', value: '362', line: true },
    { key: 'teachers', label: 'Преподаватели', color: '#eb6834', value: '25', line: true },
  ]

  it('без onToggle элементы не кнопки', () => {
    render(<ChartLegend items={items} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Студенты')).toBeInTheDocument()
  })

  it('с onToggle элементы переключают серию', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ChartLegend items={items} hidden={new Set()} onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: /Студенты/ }))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('students')
  })

  it('скрытая серия помечена aria-pressed=false', () => {
    render(<ChartLegend items={items} hidden={new Set(['teachers'])} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Студенты/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Преподаватели/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('значение серии выводится рядом с подписью', () => {
    // Правило рельефа: цифра в легенде, а не только цвет.
    render(<ChartLegend items={items} />)
    expect(screen.getByText('362')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
  })
})

describe('ActivityGrid', () => {
  const cells = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => (d === 0 && h === 18 ? 6 : 0)),
  )
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const title = (day: string, hour: number, value: number) => `${day}, ${hour}:00 — ${value}`

  function setup() {
    return render(
      <ActivityGrid
        cells={cells}
        max={6}
        palette={palette}
        dayLabels={days}
        cellTitle={title}
        ariaLabel="Активность"
      />,
    )
  }

  // Клетки — не кнопки: нажатие на них ничего не делает, они только показывают значение
  // при наведении и фокусе. Поэтому ищем их по подписи, а не по роли.
  it('рисует 7×24 ячейки', () => {
    const { container } = setup()
    expect(container.querySelectorAll('span[aria-label]')).toHaveLength(7 * 24)
  })

  it('наведение показывает значение строкой над сеткой', async () => {
    const user = userEvent.setup()
    setup()
    await user.hover(screen.getByLabelText('Пн, 18:00 — 6'))
    // Значение выводится один раз над сеткой, а не 168 всплывающими подсказками.
    expect(screen.getByText('Пн, 18:00 — 6')).toBeInTheDocument()
  })

  it('значение доступно и по фокусу с клавиатуры', async () => {
    const user = userEvent.setup()
    setup()
    await user.tab()
    // Первая ячейка — Пн, 00:00.
    expect(screen.getByLabelText('Пн, 0:00 — 0')).toHaveFocus()
  })
})

describe('Meter', () => {
  it('сообщает долю через role=meter', () => {
    render(<Meter ratio={60} palette={palette} label="Конверсия" valueText="60%" />)
    const meter = screen.getByRole('meter', { name: 'Конверсия' })
    expect(meter).toHaveAttribute('aria-valuenow', '60')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
  })

  it('значения вне 0…100 обрезаются', () => {
    render(<Meter ratio={140} palette={palette} label="Конверсия" valueText="140%" />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
  })
})

describe('StatTile', () => {
  it('показывает подпись, значение и подсказку', () => {
    render(<StatTile label="Пользователей" value="396" hint="новые за 14 дней" />)
    expect(screen.getByText('Пользователей')).toBeInTheDocument()
    expect(screen.getByText('396')).toBeInTheDocument()
    expect(screen.getByText('новые за 14 дней')).toBeInTheDocument()
  })

  it('вход анимируется, но отключается при reduced-motion', () => {
    const { container } = render(<StatTile label="DAU" value="33" index={2} />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.className).toContain('animate-in')
    // Класс motion-reduce гасит анимацию у тех, кто её отключил в системе.
    expect(tile.className).toContain('motion-reduce:animate-none')
    // Задержка по индексу — плитки появляются волной, а не разом.
    expect(tile.style.animationDelay).toBe('140ms')
  })

  it('дельта вытесняет подсказку и красится по направлению', () => {
    const { rerender } = render(
      <StatTile
        label="Медиана"
        value="2.9 ч"
        hint="жалобы"
        delta={{ text: 'быстрее на 1 ч', good: true }}
      />,
    )
    expect(screen.getByText('быстрее на 1 ч')).toHaveClass('text-success')
    expect(screen.queryByText('жалобы')).not.toBeInTheDocument()

    rerender(
      <StatTile
        label="Медиана"
        value="4 ч"
        hint="жалобы"
        delta={{ text: 'медленнее на 1 ч', good: false }}
      />,
    )
    expect(screen.getByText('медленнее на 1 ч')).toHaveClass('text-destructive')
  })
})
