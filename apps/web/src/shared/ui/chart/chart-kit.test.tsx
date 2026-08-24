import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { ChartTooltip, type ChartTooltipProps } from './chart-kit'

// Подсказка — единственная часть графика, которую видно только под курсором,
// поэтому её содержимое проверяем рендером, а не глазами на скриншоте.

function item(over: { dataKey: string; name?: string; value: number; color?: string }) {
  // В payload recharts кладёт больше полей; подсказке нужны только эти.
  return { graphicalItemId: over.dataKey, ...over } as ChartTooltipProps['payload'][number]
}

function show(props: Partial<ChartTooltipProps>) {
  return render(
    <NextIntlClientProvider locale="ru" messages={{}}>
      <ChartTooltip active payload={[]} {...props} />
    </NextIntlClientProvider>,
  )
}

describe('ChartTooltip', () => {
  it('значение ведёт, подпись серии следует', () => {
    show({ label: '12 авг.', payload: [item({ dataKey: 'students', name: 'Студенты', value: 5 })] })
    expect(screen.getByText('12 авг.')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Студенты')).toBeInTheDocument()
  })

  it('у одной серии без имени подпись корзины не дублируется', () => {
    // Горизонтальные полосы: имя серии там повторяло бы заголовок — «Группы · Группы».
    show({ label: 'Группы', payload: [item({ dataKey: 'value', value: 15 })], marker: false })
    expect(screen.getAllByText('Группы')).toHaveLength(1)
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('у стека показывает сумму по корзине', () => {
    show({
      label: '27 июл.',
      total: true,
      totalLabel: 'всего',
      payload: [
        item({ dataKey: 'USED', name: 'Использовано', value: 21 }),
        item({ dataKey: 'EXPIRED', name: 'Истекло', value: 8 }),
      ],
    })
    expect(screen.getByText('29')).toBeInTheDocument()
    expect(screen.getByText('всего')).toBeInTheDocument()
  })

  it('сумму по одной серии не показывает — целое и часть совпали бы', () => {
    show({
      label: '27 июл.',
      total: true,
      totalLabel: 'всего',
      payload: [item({ dataKey: 'USED', name: 'Использовано', value: 21 })],
    })
    expect(screen.queryByText('всего')).not.toBeInTheDocument()
  })

  it('вне наведения и без данных ничего не рисует', () => {
    const { container } = show({ active: false, payload: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('пустые значения серий отбрасывает, а не показывает нулями', () => {
    // Скрытая серия приходит в payload со value === null.
    show({
      label: '12 авг.',
      payload: [
        item({ dataKey: 'dau', name: 'За сутки', value: 4 }),
        { graphicalItemId: 'wau', dataKey: 'wau', name: 'За неделю', value: null },
      ] as ChartTooltipProps['payload'],
    })
    expect(screen.queryByText('За неделю')).not.toBeInTheDocument()
    expect(screen.getByText('За сутки')).toBeInTheDocument()
  })
})
