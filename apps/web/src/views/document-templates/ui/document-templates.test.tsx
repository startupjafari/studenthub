import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_TEMPLATE_VARIABLES } from '@studenthub/shared-config'
import type { DocumentTemplateValidation } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { useTemplateTexts } from '../lib/use-template-texts'
import { ValidationReport } from './validation-report'
import { VariableCatalog } from './variable-catalog'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

// user-event ставит свой буфер обмена при setup() — следим за ним уже после.
function setupUser() {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText')
  return { user, writeText }
}

afterEach(() => vi.clearAllMocks())

describe('VariableCatalog', () => {
  it('показывает все переменные реестра с человеческими названиями', () => {
    render(<VariableCatalog />, { wrapper })
    expect(screen.getAllByRole('listitem')).toHaveLength(DOCUMENT_TEMPLATE_VARIABLES.length)
    expect(screen.getByText('ФИО студента')).toBeInTheDocument()
    expect(screen.getByText('{student.fullName}')).toBeInTheDocument()
    // Полей, которых нет в StudentHub, в каталоге нет.
    expect(screen.queryByText('{student.iin}')).not.toBeInTheDocument()
  })

  it('ищет по названию и по технической переменной', async () => {
    const user = userEvent.setup()
    render(<VariableCatalog />, { wrapper })
    await user.type(screen.getByLabelText('Поиск переменной'), 'факультет')
    expect(screen.getByText('{student.faculty}')).toBeInTheDocument()
    expect(screen.queryByText('{student.fullName}')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Поиск переменной'))
    await user.type(screen.getByLabelText('Поиск переменной'), 'зачётка')
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
  })

  it('копирует переменную в фигурных скобках и подтверждает', async () => {
    const { user, writeText } = setupUser()
    render(<VariableCatalog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Скопировать переменную «ФИО студента»' }))
    expect(writeText).toHaveBeenCalledWith('{student.fullName}')
    expect(toast.success).toHaveBeenCalledWith('Скопировано: {student.fullName}')
  })

  it('«Скопировать все» кладёт справочник со всеми переменными', async () => {
    const { user, writeText } = setupUser()
    render(<VariableCatalog />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Скопировать все переменные' }))
    const text = writeText.mock.calls[0]?.[0] as string
    for (const v of DOCUMENT_TEMPLATE_VARIABLES) expect(text).toContain(`{${v.key}}`)
    expect(text).toContain('ФИО студента — {student.fullName}')
  })
})

describe('ValidationReport', () => {
  it('объясняет ошибки человеческим языком', () => {
    const validation: DocumentTemplateValidation = {
      valid: false,
      variables: ['student.fullName'],
      errors: [
        { code: 'UNKNOWN_VARIABLE', tag: 'student.unknownField', part: 'body' },
        { code: 'SYNTAX', tag: 'student.group', part: 'footer' },
      ],
      warnings: [{ code: 'PERSONAL_DATA' }],
    }
    render(<ValidationReport validation={validation} />, { wrapper })
    expect(screen.getByText('Шаблон нужно исправить')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Переменная {student.unknownField} не поддерживается StudentHub. Проверьте написание по каталогу.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'В документе обнаружена ошибка в переменной в нижнем колонтитуле. Проверьте фигурные скобки и повторите загрузку.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('ФИО студента')).toBeInTheDocument()
  })

  it('сводит лишние ошибки в одну строку с их числом', () => {
    render(
      <ValidationReport
        validation={{
          valid: false,
          variables: [],
          errors: [{ code: 'MORE_ISSUES', tag: '12' }],
          warnings: [],
        }}
      />,
      { wrapper },
    )
    expect(
      screen.getByText('И ещё 12 похожих ошибок — исправьте перечисленные и загрузите файл снова.'),
    ).toBeInTheDocument()
  })

  it('при синтаксической ошибке не пишет «переменных нет»', () => {
    render(
      <ValidationReport
        validation={{ valid: false, variables: [], errors: [{ code: 'SYNTAX' }], warnings: [] }}
      />,
      { wrapper },
    )
    expect(screen.queryByText('Переменных в документе нет')).not.toBeInTheDocument()
  })

  it('годный шаблон без ошибок', () => {
    render(
      <ValidationReport
        validation={{
          valid: true,
          variables: [],
          errors: [],
          warnings: [{ code: 'NO_VARIABLES' }],
        }}
      />,
      { wrapper },
    )
    expect(screen.getByText('Шаблон прошёл проверку')).toBeInTheDocument()
    expect(screen.getByText('Переменных в документе нет')).toBeInTheDocument()
  })
})

describe('useTemplateTexts.errorText', () => {
  function Probe({ error }: { error: unknown }) {
    const { errorText } = useTemplateTexts()
    return <p>{errorText(error)}</p>
  }

  it('незаполненные поля студента — названиями полей', () => {
    render(
      <Probe
        error={{
          code: 'TEMPLATE_DATA_MISSING',
          details: [{ field: 'student.faculty', message: 'x' }],
        }}
      />,
      { wrapper },
    )
    expect(
      screen.getByText('Не удалось сформировать документ. Не заполнено: Факультет.'),
    ).toBeInTheDocument()
  })

  it('отказ в файле — по причине', () => {
    render(
      <Probe
        error={{ code: 'TEMPLATE_FILE_INVALID', details: [{ field: 'file', message: 'MACROS' }] }}
      />,
      { wrapper },
    )
    expect(screen.getByText(/В документе есть макросы/)).toBeInTheDocument()
  })
})
