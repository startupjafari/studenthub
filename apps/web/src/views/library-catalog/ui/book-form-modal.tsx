'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import { CreateBookSchema, type CreateBookInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal, Textarea } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  createBookRequest,
  libraryKeys,
  updateBookRequest,
  type BookCard,
} from '../../../entities/library'

interface Props {
  onClose: () => void
  /** Есть — правка карточки; нет — новая книга, после создания переходим на её страницу. */
  book?: BookCard
  basePath: string
}

/** Пустое необязательное поле — «не указано», а не пустая строка. */
const optional = (v: string) => (v.trim() === '' ? undefined : v)

export function BookFormModal({ onClose, book, basePath }: Props) {
  const t = useTranslations('LibraryCatalog')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const router = useRouter()

  // Вход схемы шире выхода: у авторов значение по умолчанию, поэтому три типа формы.
  const form = useForm<z.input<typeof CreateBookSchema>, unknown, CreateBookInput>({
    resolver: zodResolver(CreateBookSchema),
    defaultValues: book
      ? {
          title: book.title,
          authors: book.authors,
          isbn: book.isbn ?? undefined,
          publisher: book.publisher ?? undefined,
          year: book.year ?? undefined,
          section: book.section ?? undefined,
          description: book.description ?? undefined,
        }
      : { authors: '' },
  })
  const errors = form.formState.errors

  const mutation = useMutation({
    mutationFn: (values: CreateBookInput) =>
      book
        ? updateBookRequest(book.id, {
            title: values.title,
            authors: values.authors,
            isbn: values.isbn ?? null,
            publisher: values.publisher ?? null,
            year: values.year ?? null,
            section: values.section ?? null,
            description: values.description ?? null,
          })
        : createBookRequest(values),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(book ? t('bookSaved') : t('bookCreated'))
      onClose()
      if (!book) router.push(`${basePath}/${saved.id}`)
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'VALIDATION_ERROR') {
        for (const d of err.details ?? []) {
          if (d.field in form.getValues()) {
            // Текст под полем — наш перевод (FRONTEND_RULES §5.4), не сообщение сервера.
            form.setError(d.field as keyof CreateBookInput, { type: 'server' })
          }
        }
        return
      }
      toast.error(tErr(err.code))
    },
  })

  const message = (field: keyof CreateBookInput, fallback: string): string | null => {
    const error = errors[field]
    if (!error) return null
    return error.type === 'server' ? (error.message ?? fallback) : fallback
  }

  return (
    <Modal onClose={onClose} title={book ? t('editBook') : t('addBook')} size="lg">
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="book-title">{t('fieldTitle')}</Label>
          <Input
            id="book-title"
            autoFocus
            aria-invalid={!!errors.title}
            {...form.register('title')}
          />
          <FieldError>{message('title', t('titleRequired'))}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="book-authors">{t('fieldAuthors')}</Label>
          <Input
            id="book-authors"
            placeholder={t('authorsPlaceholder')}
            aria-invalid={!!errors.authors}
            {...form.register('authors')}
          />
          <FieldError>{message('authors', t('tooLong'))}</FieldError>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="book-isbn">ISBN</Label>
            <Input
              id="book-isbn"
              inputMode="numeric"
              aria-invalid={!!errors.isbn}
              {...form.register('isbn', { setValueAs: optional })}
            />
            <FieldError>{message('isbn', t('isbnInvalid'))}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-year">{t('fieldYear')}</Label>
            <Input
              id="book-year"
              type="number"
              inputMode="numeric"
              aria-invalid={!!errors.year}
              {...form.register('year', {
                setValueAs: (v: string) => (v === '' ? undefined : Number(v)),
              })}
            />
            <FieldError>{message('year', t('yearInvalid'))}</FieldError>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-publisher">{t('fieldPublisher')}</Label>
            <Input
              id="book-publisher"
              aria-invalid={!!errors.publisher}
              {...form.register('publisher', { setValueAs: optional })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book-section">{t('section')}</Label>
            <Input
              id="book-section"
              placeholder={t('sectionPlaceholder')}
              aria-invalid={!!errors.section}
              {...form.register('section', { setValueAs: optional })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="book-description">{t('fieldDescription')}</Label>
          <Textarea
            id="book-description"
            rows={3}
            aria-invalid={!!errors.description}
            {...form.register('description', { setValueAs: optional })}
          />
          <FieldError>{message('description', t('tooLong'))}</FieldError>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {book ? t('save') : t('addBook')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
