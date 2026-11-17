import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть: проверяем поведение, а не подписи.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))

import { AttachmentDialog } from './attachment-dialog'

function Harness({ initial }: { initial: File[] }) {
  const [files, setFiles] = useState(initial)
  return (
    <AttachmentDialog
      files={files}
      sending={false}
      onSend={() => undefined}
      onAddMore={() => undefined}
      onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
      onReorder={(from, to) =>
        setFiles((prev) => {
          const next = [...prev]
          const [moved] = next.splice(from, 1)
          if (moved) next.splice(to, 0, moved)
          return next
        })
      }
      onClose={() => undefined}
    />
  )
}

const doc = (name: string) => new File(['x'], name, { type: 'application/pdf' })

/** Строки файлов сверху вниз — по имени, как их видит человек. */
function order(): string[] {
  return screen
    .getAllByRole('button', { name: 'removeAttachment' })
    .map((b) => b.closest('[data-attachment-key]')?.textContent?.match(/[a-c]\.pdf/)?.[0] ?? '')
}

describe('AttachmentDialog — перестановка с клавиатуры (П.34)', () => {
  it('после Alt+↓ фокус остаётся на той же строке, и её можно двигать дальше', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[doc('a.pdf'), doc('b.pdf'), doc('c.pdf')]} />)
    expect(order()).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])

    const row = screen.getByText('a.pdf').closest('[data-attachment-key]') as HTMLElement
    within(row).getByRole('button', { name: 'removeAttachment' }).focus()

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(order()).toEqual(['b.pdf', 'a.pdf', 'c.pdf'])
    const focused = document.activeElement as HTMLElement
    expect(focused.closest('[data-attachment-key]')?.textContent).toContain('a.pdf')

    // Вторая перестановка подряд — без повторного клика по строке.
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(order()).toEqual(['b.pdf', 'c.pdf', 'a.pdf'])
    expect(
      (document.activeElement as HTMLElement).closest('[data-attachment-key]')?.textContent,
    ).toContain('a.pdf')
  })
})
