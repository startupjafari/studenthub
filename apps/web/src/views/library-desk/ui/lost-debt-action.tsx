'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Ellipsis } from 'lucide-react'
import type { LoanItem } from '@studenthub/shared-schemas'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useConfirm,
} from '../../../shared/ui'
import { libraryKeys, settleLostLoanRequest } from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// Утерянная книга — долг читателя, пока библиотекарь не отметит погашение (docs/PROJECT.md
// §3.11): читатель принёс замену или возместил стоимость. Отметка снимает долг со справки и
// открывает выдачу и брони; выдача остаётся «утерянной» в истории. Меню того же вида, что у
// открытой выдачи: колонка действий в таблице узкая, текстовая кнопка в неё не встаёт.
export function LostDebtAction({ loan }: { loan: LoanItem }) {
  const t = useTranslations('LibraryDesk')
  const describe = useDeskErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const settle = useMutation({
    mutationFn: () => settleLostLoanRequest(loan.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('settledToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })

  async function onSettle(): Promise<void> {
    const ok = await confirm({
      title: t('settleLostTitle'),
      description: t('settleLostDesc', { title: loan.book.title, name: loan.reader.name }),
      confirmLabel: t('settleLost'),
    })
    if (ok) settle.mutate()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={t('loanActions')}
          loading={settle.isPending}
        >
          <Ellipsis className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void onSettle()}>{t('settleLost')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
