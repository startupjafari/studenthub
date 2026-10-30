'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  BOOK_CONDITIONS,
  LIBRARY_COPIES_MAX,
  type BookConditionValue,
} from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { addBookCopiesRequest, libraryKeys, type BookCopyItem } from '../../../entities/library'
import { useConditionLabels } from '../lib/use-condition-labels'

type Mode = 'count' | 'numbers'

/** Номера из поля: через запятую, точку с запятой или с новой строки. */
function parseNumbers(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

export function AddCopiesModal({
  bookId,
  onClose,
  onAdded,
}: {
  bookId: string
  onClose: () => void
  /** Новые экземпляры — сразу предложить им наклейки. */
  onAdded: (copies: BookCopyItem[]) => void
}) {
  const t = useTranslations('LibraryCatalog')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const conditionLabel = useConditionLabels()
  const [mode, setMode] = useState<Mode>('count')
  const [count, setCount] = useState('1')
  const [numbers, setNumbers] = useState('')
  const [condition, setCondition] = useState<BookConditionValue>('GOOD')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      addBookCopiesRequest(bookId, {
        condition,
        ...(mode === 'count'
          ? { count: Number(count) }
          : { inventoryNumbers: parseNumbers(numbers) }),
      }),
    onSuccess: (copies) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('copiesAdded', { count: copies.length }))
      onAdded(copies)
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'CONFLICT') setError(t('inventoryTaken'))
      else toast.error(tErr(err.code))
    },
  })

  function submit(): void {
    setError(null)
    if (mode === 'count') {
      const n = Number(count)
      if (!Number.isInteger(n) || n < 1 || n > LIBRARY_COPIES_MAX) {
        setError(t('countRange', { max: LIBRARY_COPIES_MAX }))
        return
      }
    } else {
      const list = parseNumbers(numbers)
      if (
        list.length === 0 ||
        list.length > LIBRARY_COPIES_MAX ||
        list.some((n) => n.length > 40)
      ) {
        setError(t('numbersInvalid', { max: LIBRARY_COPIES_MAX }))
        return
      }
    }
    mutation.mutate()
  }

  return (
    <Modal onClose={onClose} title={t('addCopies')} size="md">
      <div className="flex flex-col gap-4">
        <SegmentedTabs<Mode>
          value={mode}
          collapsible={false}
          aria-label={t('addCopies')}
          // Два способа на равных: каждая вкладка — половина ряда.
          className="[&>button]:flex-1 [&>button]:basis-0 [&>button]:justify-center"
          onChange={(v) => {
            setMode(v)
            setError(null)
          }}
          items={[
            { value: 'count', label: t('modeCount') },
            { value: 'numbers', label: t('modeNumbers') },
          ]}
        />
        {mode === 'count' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copies-count">{t('copiesCount')}</Label>
            <Input
              id="copies-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={LIBRARY_COPIES_MAX}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">{t('countHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copies-numbers">{t('inventoryNumbers')}</Label>
            <Textarea
              id="copies-numbers"
              rows={4}
              value={numbers}
              onChange={(e) => setNumbers(e.target.value)}
              placeholder="10234, 10235, 10236"
              aria-invalid={error ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">{t('numbersHint')}</p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>{t('condition')}</Label>
          <Select value={condition} onValueChange={(v) => setCondition(v as BookConditionValue)}>
            <SelectTrigger aria-label={t('condition')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOK_CONDITIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {conditionLabel[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={submit}>
            {t('addCopies')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
