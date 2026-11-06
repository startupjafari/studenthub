'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Ellipsis, Undo2 } from 'lucide-react'
import type { LoanItem } from '@studenthub/shared-schemas'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PromptDialog,
} from '../../../shared/ui'
import { cancelReturnRequest, libraryKeys } from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// «Отменить возврат» (Фаза 20.5): ошибочно принятая книга снова числится за читателем с
// прежним сроком. Как и отмена выдачи — с причиной: она уходит в аудит. Сервер откажет, если
// экземпляр с тех пор выдали, отложили под бронь или списали, — текст отказа по `details.field`.
// В таблице выдач — меню (колонка действий узкая), на экране приёма — кнопка у строки.

export interface CancelReturnActionProps {
  loan: LoanItem
  variant: 'menu' | 'button'
  onDone?: (loan: LoanItem) => void
}

export function CancelReturnAction({ loan, variant, onDone }: CancelReturnActionProps) {
  const t = useTranslations('LibraryDesk')
  const tCommon = useTranslations('Common')
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const mutation = useMutation({
    mutationFn: (reason: string) => cancelReturnRequest(loan.id, reason),
    onSuccess: (reopened) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('returnCancelledToast', { name: loan.reader.name }))
      setOpen(false)
      onDone?.(reopened)
    },
    onError: (e) => void toast.error(describe(e)),
  })

  return (
    <>
      {variant === 'menu' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('loanActions')}
              loading={mutation.isPending}
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setOpen(true)}>
              {t('cancelReturn')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={mutation.isPending}
          onClick={() => setOpen(true)}
        >
          <Undo2 className="size-4" aria-hidden />
          {t('cancelReturn')}
        </Button>
      )}
      <PromptDialog
        open={open}
        title={t('cancelReturnTitle', { title: loan.book.title, name: loan.reader.name })}
        placeholder={t('cancelReturnReason')}
        multiline
        required
        submitLabel={t('cancelReturn')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(reason) => mutation.mutate(reason)}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
