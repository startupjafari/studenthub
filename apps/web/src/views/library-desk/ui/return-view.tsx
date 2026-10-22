'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookDown, BookmarkCheck } from 'lucide-react'
import {
  BOOK_CONDITIONS,
  type BookConditionValue,
  type ReturnLoanResult,
} from '@studenthub/shared-schemas'
import {
  Button,
  Card,
  Label,
  PageHeader,
  SectionPanel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { libraryKeys, returnCopyRequest } from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'
import { CopyPicker, copyRefInput, hasCopyRef, type CopyRef } from './copy-picker'

// Приём книг (Фаза 20.5): скан наклейки или инвентарный номер, состояние книги — и выдача
// закрыта. Если книгу ждёт очередь броней, экран крупно говорит, на чьё имя её отложить.

export function ReturnView() {
  const t = useTranslations('LibraryDesk')
  const tCat = useTranslations('LibraryCatalog')
  const format = useFormatter()
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [copy, setCopy] = useState<CopyRef>({ copyCode: null, inventoryNumber: '' })
  const [condition, setCondition] = useState<BookConditionValue>('GOOD')
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState<ReturnLoanResult[]>([])
  const conditionLabel: Record<BookConditionValue, string> = {
    GOOD: tCat('conditionValue.GOOD'),
    WORN: tCat('conditionValue.WORN'),
    DAMAGED: tCat('conditionValue.DAMAGED'),
  }

  const mutation = useMutation({
    mutationFn: () => returnCopyRequest({ ...copyRefInput(copy), condition }),
    onSuccess: (result) => {
      setReturned((prev) => [result, ...prev])
      setCopy({ copyCode: null, inventoryNumber: '' })
      setCondition('GOOD')
      setError(null)
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('returnedToast', { title: result.loan.book.title }))
    },
    onError: (e) => setError(describe(e)),
  })

  const latest = returned[0]

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('returnTitle')} subtitle={t('returnSubtitle')} />

      <SectionPanel title={t('returnBook')} subtitle={t('returnBookHint')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (hasCopyRef(copy)) mutation.mutate()
          }}
        >
          <CopyPicker value={copy} onChange={setCopy} />
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label>{tCat('condition')}</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as BookConditionValue)}>
              <SelectTrigger aria-label={tCat('condition')}>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={!hasCopyRef(copy)} loading={mutation.isPending}>
              <BookDown className="size-4" aria-hidden />
              {t('acceptReturn')}
            </Button>
          </div>
        </form>
      </SectionPanel>

      {latest?.heldFor && (
        // Главное после приёма — не поставить книгу на полку, если её ждёт бронь.
        <Card className="flex-row items-start gap-3 border-warning/40 bg-warning/10 p-4">
          <BookmarkCheck className="mt-0.5 size-6 shrink-0 text-warning" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t('holdForTitle', { title: latest.loan.book.title })}</p>
            <p className="text-sm">
              {t('holdFor', {
                name: latest.heldFor.name,
                group: latest.heldFor.group ?? '—',
                date: format.dateTime(new Date(latest.heldFor.holdUntil), {
                  day: 'numeric',
                  month: 'short',
                }),
              })}
            </p>
          </div>
        </Card>
      )}

      {returned.length > 0 && (
        <SectionPanel title={t('returnedNow')} subtitle={t('returnedNowHint')}>
          <ul className="flex flex-col divide-y divide-border">
            {returned.map(({ loan, heldFor }) => (
              <li key={loan.id} className="flex items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{loan.book.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      t('inventoryShort', { number: loan.copy.inventoryNumber }),
                      loan.reader.name,
                      loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueAt)
                        ? t('wasOverdue')
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {heldFor ? t('toHoldShelf') : t('toShelf')}
                </span>
              </li>
            ))}
          </ul>
        </SectionPanel>
      )}
    </div>
  )
}
