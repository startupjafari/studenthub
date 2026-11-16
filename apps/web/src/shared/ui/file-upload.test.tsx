import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import ru from '../../../messages/ru.json'
import { FileUpload } from './file-upload'

const DOCX = {
  mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  extensions: ['.docx'],
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      {children}
    </NextIntlClientProvider>
  )
}

function pick(file: File) {
  render(<FileUpload category="DOCUMENT" accept={DOCX} uploadFn={vi.fn()} onUploaded={vi.fn()} />, {
    wrapper,
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('FileUpload с accept', () => {
  it('принимает .docx, даже если браузер назвал тип общим', () => {
    pick(new File(['x'], 'Справка.docx', { type: 'application/octet-stream' }))
    expect(screen.getByText('Справка.docx')).toBeInTheDocument()
    expect(screen.queryByText('Недопустимый тип файла')).not.toBeInTheDocument()
  })

  it('принимает .docx без типа', () => {
    pick(new File(['x'], 'Справка.DOCX', { type: '' }))
    expect(screen.getByText('Справка.DOCX')).toBeInTheDocument()
  })

  it('отклоняет файл с другим расширением, даже из той же категории', () => {
    pick(new File(['x'], 'scan.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('Недопустимый тип файла')).toBeInTheDocument()
  })
})
