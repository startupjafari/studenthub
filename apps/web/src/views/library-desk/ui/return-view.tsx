'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookDown, BookmarkCheck } from 'lucide-react'
import {
  BOOK_CONDITIONS,
  type BookConditionValue,
  type ReturnLoanResult,
} from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  SectionPanel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
} from '../../../shared/ui'
import { LoanDueBadge, fetchLoans, libraryKeys, returnCopyRequest } from '../../../entities/library'
import { cn } from '../../../shared/lib'
import { useDeskErrors } from '../lib/desk-errors'
import { CancelReturnAction } from './cancel-return-action'
import { CopyPicker, copyRefInput, hasCopyRef, type CopyRef } from './copy-picker'

// Приём книг (Фаза 20.5): скан наклейки или инвентарный номер, состояние книги — и выдача
// закрыта. Если книгу ждёт очередь броней, экран крупно говорит, на чьё имя её отложить.
// Ошибочно принятую книгу здесь же можно вернуть за читателем — «Отменить возврат» у строки.

// «Принято сейчас»: книга · инв. номер · читатель · срок · куда · действия.
const COLS = ['auto', '9rem', '24%', '9rem', '10rem', '3.5rem'] as const
// На узком экране — книга и куда её нести: это и нужно у стойки сразу после приёма.
const COLS_NARROW = ['auto', '0', '0', '0', '8.5rem', '3.5rem'] as const
const HIDE = {
  inventory: 'hidden md:table-cell',
  reader: 'hidden md:table-cell',
  due: 'hidden lg:table-cell',
} as const

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
    // `min-h-0` у корня: таблица прокручивается внутри панели, а не страницей.
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1">
      <PageHeader title={t('returnTitle')} subtitle={t('returnSubtitle')} />
      {/* Слева — принятое за сеанс до низа окна, справа (~20%) — форма приёма и просрочки.
          На узком экране первой идёт форма: ради неё на экран и приходят. */}
      <div className="grid gap-6 lg:min-h-80 lg:flex-1 lg:grid-cols-[minmax(0,4fr)_minmax(16rem,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <SectionPanel
          title={t('returnBook')}
          subtitle={t('returnBookHint')}
          className="lg:col-start-2 lg:row-start-1"
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (hasCopyRef(copy)) mutation.mutate()
            }}
          >
            <CopyPicker value={copy} onChange={setCopy} stacked />
            <div className="flex flex-col gap-1.5">
              <Label>{tCat('condition')}</Label>
              <Select
                value={condition}
                onValueChange={(v) => setCondition(v as BookConditionValue)}
              >
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
            <Button
              type="submit"
              className="w-full"
              disabled={!hasCopyRef(copy)}
              loading={mutation.isPending}
            >
              <BookDown className="size-4" aria-hidden />
              {t('acceptReturn')}
            </Button>
          </form>
        </SectionPanel>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0">
          {latest?.heldFor && (
            // Главное после приёма — не поставить книгу на полку, если её ждёт бронь.
            <Card className="flex-row items-start gap-3 border-warning/40 bg-warning/10 p-4">
              <BookmarkCheck className="mt-0.5 size-6 shrink-0 text-warning" aria-hidden />
              <div className="flex flex-col gap-1">
                <p className="font-semibold">
                  {t('holdForTitle', { title: latest.loan.book.title })}
                </p>
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

          <SectionPanel
            title={t('returnedNow')}
            subtitle={t('returnedNowHint')}
            className="lg:min-h-0 lg:flex-1"
            bodyClassName="flex flex-col p-0 lg:min-h-0 lg:flex-1"
          >
            {returned.length === 0 ? (
              <EmptyState
                icon={<BookDown className="size-6" aria-hidden />}
                title={t('returnedEmpty')}
                className="m-4"
              />
            ) : (
              <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colBook')}</TableHead>
                    <TableHead className={HIDE.inventory}>{t('colInventoryNumber')}</TableHead>
                    <TableHead className={HIDE.reader}>{t('colReader')}</TableHead>
                    <TableHead className={HIDE.due}>{t('colDue')}</TableHead>
                    <TableHead>{t('colDestination')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t('loanActions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returned.map(({ loan, heldFor }) => (
                    <TableRow key={loan.id}>
                      <TableCell className="font-medium">
                        <TableText value={loan.book.title} />
                      </TableCell>
                      <TableCell className={cn(HIDE.inventory, 'font-mono tabular-nums')}>
                        <TableText value={loan.copy.inventoryNumber} />
                      </TableCell>
                      <TableCell className={cn(HIDE.reader, 'text-muted-foreground')}>
                        <TableText value={loan.reader.name} />
                      </TableCell>
                      <TableCell className={HIDE.due}>
                        {loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueAt) ? (
                          <Badge variant="destructive">{t('wasOverdue')}</Badge>
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell>
                        {heldFor ? (
                          <Badge variant="warning">{t('toHoldShelf')}</Badge>
                        ) : (
                          <span className="text-muted-foreground">{t('toShelf')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Отложенную под бронь книгу откатить нельзя — сервер ответит 409. */}
                        {!heldFor && (
                          <CancelReturnAction
                            loan={loan}
                            variant="menu"
                            onDone={() =>
                              setReturned((prev) => prev.filter((r) => r.loan.id !== loan.id))
                            }
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionPanel>
        </div>

        <DueTodayPanel className="lg:col-start-2 lg:row-start-2 lg:min-h-0" />
      </div>
    </div>
  )
}

const DUE_LIMIT = 6

/** Кто должен вернуть книги — первые просроченные: их ждут у стойки в первую очередь. */
function DueTodayPanel({ className }: { className?: string }) {
  const t = useTranslations('LibraryDesk')
  const params = { filter: 'overdue' as const, page: 1, limit: DUE_LIMIT }
  const overdue = useQuery({
    queryKey: libraryKeys.loans(params),
    queryFn: () => fetchLoans(params),
  })
  const items = overdue.data?.items ?? []
  return (
    <SectionPanel
      title={t('overdueTitle')}
      subtitle={t('overdueHint')}
      className={className}
      bodyClassName="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
    >
      {overdue.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} fill className="min-h-10 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noOverdue')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((loan) => (
            <li key={loan.id} className="flex items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{loan.book.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[loan.reader.name, loan.reader.group].filter(Boolean).join(' · ')}
                </span>
              </div>
              <LoanDueBadge loan={loan} />
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}
