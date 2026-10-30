'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  BOOK_CONDITIONS,
  type BookConditionValue,
  type UpdateBookCopyInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  CopyStatusBadge,
  libraryKeys,
  updateBookCopyRequest,
  type BookCopyItem,
} from '../../../entities/library'
import { useConditionLabels } from '../lib/use-condition-labels'

// Правка экземпляра: номер, состояние, заметка; вывод из оборота (утерян, списан) и возврат
// на полку. Выданный или отложенный экземпляр из оборота не выводится — это делают выдачи.

export function CopyEditModal({ copy, onClose }: { copy: BookCopyItem; onClose: () => void }) {
  const t = useTranslations('LibraryCatalog')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const conditionLabel = useConditionLabels()
  const [inventoryNumber, setInventoryNumber] = useState(copy.inventoryNumber)
  const [condition, setCondition] = useState<BookConditionValue>(copy.condition)
  const [note, setNote] = useState(copy.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (input: UpdateBookCopyInput) => updateBookCopyRequest(copy.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('copySaved'))
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      const field = err.details?.[0]?.field
      if (err.code === 'CONFLICT' && field === 'inventoryNumber') setError(t('inventoryTaken'))
      else if (err.code === 'CONFLICT') setError(t('copyBusy'))
      else toast.error(tErr(err.code))
    },
  })

  const busy = copy.status === 'ON_LOAN' || copy.status === 'RESERVED'
  const out = copy.status === 'LOST' || copy.status === 'WRITTEN_OFF'

  async function withdraw(status: 'LOST' | 'WRITTEN_OFF'): Promise<void> {
    const ok = await confirm({
      title: status === 'LOST' ? t('markLostTitle') : t('writeOffTitle'),
      description: t('withdrawDesc', { number: copy.inventoryNumber }),
      confirmLabel: status === 'LOST' ? t('markLost') : t('writeOff'),
      destructive: true,
    })
    if (ok) mutation.mutate({ status })
  }

  function save(): void {
    setError(null)
    const number = inventoryNumber.trim()
    if (!number || number.length > 40) {
      setError(t('numbersInvalid', { max: 1 }))
      return
    }
    mutation.mutate({
      ...(number !== copy.inventoryNumber ? { inventoryNumber: number } : {}),
      ...(condition !== copy.condition ? { condition } : {}),
      ...(note.trim() !== (copy.note ?? '') ? { note: note.trim() || null } : {}),
    })
  }

  return (
    <Modal onClose={onClose} title={t('editCopy')} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('statusLabel')}</span>
          <CopyStatusBadge status={copy.status} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="copy-number">{t('inventoryNumber')}</Label>
          <Input
            id="copy-number"
            value={inventoryNumber}
            onChange={(e) => setInventoryNumber(e.target.value)}
            aria-invalid={error ? true : undefined}
            // Номер выданного экземпляра меняют после возврата: по нему принимают книгу.
            disabled={copy.status === 'ON_LOAN'}
          />
        </div>
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="copy-note">{t('note')}</Label>
          <Textarea
            id="copy-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {out ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate({ status: 'AVAILABLE' })}
            >
              {t('backToShelf')}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                title={busy ? t('copyBusy') : undefined}
                onClick={() => void withdraw('LOST')}
              >
                {t('markLost')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                title={busy ? t('copyBusy') : undefined}
                onClick={() => void withdraw('WRITTEN_OFF')}
              >
                {t('writeOff')}
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={save}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
