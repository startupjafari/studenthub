'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Ellipsis } from 'lucide-react'
import { BOOK_CONDITIONS, type BookConditionValue, type LoanItem } from '@studenthub/shared-schemas'
import {
  Button,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Label,
  Modal,
  PromptDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from '../../../shared/ui'
import {
  cancelLoanRequest,
  libraryKeys,
  markLoanLostRequest,
  renewLoanRequest,
  returnCopyRequest,
} from '../../../entities/library'
import { localToday, useDeskErrors } from '../lib/desk-errors'

// Действия над открытой выдачей у библиотекаря (Фаза 20.5): принять, продлить, утеряна,
// отменить ошибочную выдачу. Удостоверение читателя (20.6) — отдельной кнопкой.

type Dialog = 'return' | 'renew' | 'cancel' | null

export function LoanActions({ loan, extra }: { loan: LoanItem; extra?: React.ReactNode }) {
  const t = useTranslations('LibraryDesk')
  const tCat = useTranslations('LibraryCatalog')
  const tCommon = useTranslations('Common')
  const describe = useDeskErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [condition, setCondition] = useState<BookConditionValue>('GOOD')
  const [dueDate, setDueDate] = useState('')
  const conditionLabel: Record<BookConditionValue, string> = {
    GOOD: tCat('conditionValue.GOOD'),
    WORN: tCat('conditionValue.WORN'),
    DAMAGED: tCat('conditionValue.DAMAGED'),
  }

  const done = (message: string): void => {
    void qc.invalidateQueries({ queryKey: libraryKeys.all })
    toast.success(message)
    setDialog(null)
  }
  const onError = (e: unknown): void => void toast.error(describe(e))

  const returnMut = useMutation({
    mutationFn: () => returnCopyRequest({ inventoryNumber: loan.copy.inventoryNumber, condition }),
    onSuccess: (result) =>
      done(
        result.heldFor
          ? t('returnedHeldToast', { name: result.heldFor.name })
          : t('returnedToast', { title: loan.book.title }),
      ),
    onError,
  })
  const renewMut = useMutation({
    mutationFn: () => renewLoanRequest(loan.id, dueDate ? { dueDate } : {}),
    onSuccess: () => done(t('renewedToast')),
    onError,
  })
  const lostMut = useMutation({
    mutationFn: () => markLoanLostRequest(loan.id),
    onSuccess: () => done(t('lostToast')),
    onError,
  })
  const cancelMut = useMutation({
    mutationFn: (reason: string) => cancelLoanRequest(loan.id, reason),
    onSuccess: () => done(t('cancelledToast')),
    onError,
  })

  async function markLost(): Promise<void> {
    const ok = await confirm({
      title: t('lostTitle'),
      description: t('lostDesc', { title: loan.book.title, name: loan.reader.name }),
      confirmLabel: t('markLost'),
      destructive: true,
    })
    if (ok) lostMut.mutate()
  }

  return (
    <>
      {extra}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" icon aria-label={t('loanActions')}>
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('return')}>
            {t('acceptReturn')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('renew')}>{t('renew')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void markLost()}>
            {t('markLost')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('cancel')}>
            {t('cancelLoan')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'return' && (
        <Modal onClose={() => setDialog(null)} title={t('acceptReturn')} size="md">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t('returnOf', { title: loan.book.title, number: loan.copy.inventoryNumber })}
            </p>
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
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                loading={returnMut.isPending}
                onClick={() => returnMut.mutate()}
              >
                {t('acceptReturn')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {dialog === 'renew' && (
        <Modal onClose={() => setDialog(null)} title={t('renew')} size="md">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('renewHint')}</p>
            <div className="flex flex-col gap-1.5">
              <Label>{t('newDueDate')}</Label>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                min={localToday()}
                placeholder={t('byDefault')}
                aria-label={t('newDueDate')}
              />
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                {tCommon('cancel')}
              </Button>
              <Button type="button" loading={renewMut.isPending} onClick={() => renewMut.mutate()}>
                {t('renew')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <PromptDialog
        open={dialog === 'cancel'}
        title={t('cancelTitle')}
        placeholder={t('cancelReason')}
        multiline
        required
        submitLabel={t('cancelLoan')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(reason) => cancelMut.mutate(reason)}
        onClose={() => setDialog(null)}
      />
    </>
  )
}
