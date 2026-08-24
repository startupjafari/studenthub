import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import ru from '../../../messages/ru.json'
import { TablePagination, nextSort, pageItems, sortRows } from './table'

// Берём настоящие ru-строки, а не заглушки: тест заодно ловит пропавший ключ.
function renderPagination(props: {
  page: number
  total: number
  limit: number
  onPageChange?: (page: number) => void
  limitOptions?: readonly number[]
  onLimitChange?: (limit: number) => void
}) {
  const onPageChange = props.onPageChange ?? vi.fn()
  render(
    <NextIntlClientProvider locale="ru" messages={ru}>
      <TablePagination {...props} onPageChange={onPageChange} />
    </NextIntlClientProvider>,
  )
  return { onPageChange }
}

describe('pageItems', () => {
  it('мало страниц — все номера подряд', () => {
    expect(pageItems(1, 4)).toEqual([1, 2, 3, 4])
  })

  it('много страниц — первая, окно вокруг текущей, последняя и пропуски', () => {
    expect(pageItems(7, 20)).toEqual([1, 'gap', 6, 7, 8, 'gap', 20])
  })

  it('у краёв пропуск только с одной стороны', () => {
    expect(pageItems(2, 20)).toEqual([1, 2, 3, 'gap', 20])
    expect(pageItems(20, 20)).toEqual([1, 'gap', 19, 20])
  })

  it('одна страница — один номер, без дублей', () => {
    expect(pageItems(1, 1)).toEqual([1])
  })
})

describe('nextSort', () => {
  it('новая колонка сортируется по возрастанию', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'email', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })

  it('повторные клики: asc → desc → без сортировки', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toBeNull()
  })
})

describe('sortRows', () => {
  const rows = [
    { id: 1, name: 'Группа 10', score: 3, note: '' },
    { id: 2, name: 'Группа 2', score: 10, note: 'есть' },
    { id: 3, name: 'Абишев', score: 1, note: null },
  ]
  const value = (r: (typeof rows)[number], key: string): unknown =>
    key === 'name' ? r.name : key === 'score' ? r.score : r.note

  it('без сортировки возвращает исходный порядок тем же массивом', () => {
    expect(sortRows(rows, null, value)).toBe(rows)
  })

  it('числа сравниваются как числа, а не как строки', () => {
    expect(sortRows(rows, { key: 'score', dir: 'asc' }, value).map((r) => r.id)).toEqual([3, 1, 2])
  })

  it('строки — с учётом чисел внутри: «Группа 2» раньше «Группа 10»', () => {
    expect(sortRows(rows, { key: 'name', dir: 'asc' }, value).map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('направление desc переворачивает порядок', () => {
    expect(sortRows(rows, { key: 'score', dir: 'desc' }, value).map((r) => r.id)).toEqual([2, 1, 3])
  })

  it('пустые значения уходят в конец при любом направлении', () => {
    expect(sortRows(rows, { key: 'note', dir: 'asc' }, value).map((r) => r.id)).toEqual([2, 1, 3])
    expect(sortRows(rows, { key: 'note', dir: 'desc' }, value)[0]!.id).toBe(2)
  })

  it('исходный массив не мутируется', () => {
    const copy = [...rows]
    sortRows(rows, { key: 'score', dir: 'asc' }, value)
    expect(rows).toEqual(copy)
  })
})

describe('TablePagination', () => {
  it('считает число страниц по total и limit', () => {
    renderPagination({ page: 1, total: 57, limit: 20 })
    expect(screen.getByText('57 строк · Страница 1 из 3')).toBeInTheDocument()
  })

  it('на первой странице «назад» недоступна, на последней — «вперёд»', () => {
    renderPagination({ page: 1, total: 40, limit: 20 })
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled()
  })

  it('стрелка «вперёд» переводит на следующую страницу', async () => {
    const user = userEvent.setup()
    const { onPageChange } = renderPagination({ page: 2, total: 100, limit: 20 })

    await user.click(screen.getByRole('button', { name: 'Следующая страница' }))
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('страница за пределами выборки прижимается к последней', () => {
    // Так бывает после сужения фильтра: страница в состоянии осталась прежней.
    renderPagination({ page: 9, total: 57, limit: 20 })
    expect(screen.getByText('57 строк · Страница 3 из 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled()
  })

  it('номер страницы открывает именно её, текущая помечена aria-current', async () => {
    const user = userEvent.setup()
    const { onPageChange } = renderPagination({ page: 2, total: 100, limit: 20 })

    expect(screen.getByRole('button', { name: 'Страница 2' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await user.click(screen.getByRole('button', { name: 'Страница 5' }))
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('размер страницы показан селектором, только если варианты переданы', () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="ru" messages={ru}>
        <TablePagination page={1} total={57} limit={20} onPageChange={vi.fn()} />
      </NextIntlClientProvider>,
    )
    expect(screen.queryByText('На странице')).not.toBeInTheDocument()
    unmount()

    renderPagination({
      page: 1,
      total: 57,
      limit: 100,
      limitOptions: [20, 100, 150, 200],
      onLimitChange: vi.fn(),
    })
    expect(screen.getByText('На странице')).toBeInTheDocument()
    // Выбранный размер виден на кнопке селектора, а страниц при 100 строках — одна.
    expect(screen.getByRole('combobox')).toHaveTextContent('100')
    expect(screen.getByText('57 строк · Страница 1 из 1')).toBeInTheDocument()
  })

  it('пустая выборка — «1 из 1», а не «0 из 0»', () => {
    renderPagination({ page: 1, total: 0, limit: 20 })
    expect(screen.getByText('0 строк · Страница 1 из 1')).toBeInTheDocument()
  })
})
