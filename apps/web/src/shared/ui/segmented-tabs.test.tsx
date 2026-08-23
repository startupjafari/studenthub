import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedTabs, type SegmentedTabItem } from './segmented-tabs'

type Status = 'new' | 'done' | 'all'

const ITEMS: SegmentedTabItem<Status>[] = [
  { value: 'new', label: 'Новые', count: 3 },
  { value: 'done', label: 'Решены' },
  { value: 'all', label: 'Все', count: 0 },
]

describe('SegmentedTabs', () => {
  it('рисует кнопку на каждый раздел', () => {
    render(<SegmentedTabs items={ITEMS} value="new" onChange={vi.fn()} aria-label="Жалобы" />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('активный раздел помечен aria-pressed', () => {
    render(<SegmentedTabs items={ITEMS} value="done" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Решены' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Новые/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('клик отдаёт значение раздела', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedTabs items={ITEMS} value="new" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Решены' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('done')
  })

  it('счётчик показывается только при непустом значении', () => {
    render(<SegmentedTabs items={ITEMS} value="new" onChange={vi.fn()} />)
    // count: 3 → виден; count: 0 и отсутствующий count → скрыты.
    expect(screen.getByRole('button', { name: 'Новые 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Решены' })).toBeInTheDocument()
  })

  it('большой счётчик обрезается до 99+', () => {
    render(
      <SegmentedTabs
        items={[{ value: 'new', label: 'Новые', count: 150 }]}
        value="new"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Новые 99+' })).toBeInTheDocument()
  })

  it('группа доступна по имени', () => {
    render(<SegmentedTabs items={ITEMS} value="new" onChange={vi.fn()} aria-label="Жалобы" />)
    expect(screen.getByRole('group', { name: 'Жалобы' })).toBeInTheDocument()
  })
})
