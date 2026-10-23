'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import {
  CreateVisitorSchema,
  VISITOR_DOCUMENT_TYPES,
  type CreateVisitorInput,
  type VisitorDocumentTypeValue,
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
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { createVisitorRequest, securityKeys } from '../../../entities/security-journal'

const NO_DOCUMENT = '__none__'

/**
 * Запись посетителя на входе (docs/PROJECT.md §3.12). Документ — только тип и четыре последние
 * цифры: полный номер и ИИН не записываются (решение владельца), поле их и не примет.
 */
export function RecordVisitorModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Security')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const form = useForm<z.input<typeof CreateVisitorSchema>, unknown, CreateVisitorInput>({
    resolver: zodResolver(CreateVisitorSchema),
    defaultValues: { fullName: '', purpose: '' },
  })
  const errors = form.formState.errors
  const documentType = form.watch('documentType')

  const docLabel: Record<VisitorDocumentTypeValue, string> = {
    ID_CARD: t('docType.ID_CARD'),
    PASSPORT: t('docType.PASSPORT'),
    DRIVER_LICENSE: t('docType.DRIVER_LICENSE'),
    OTHER: t('docType.OTHER'),
  }

  const mutation = useMutation({
    mutationFn: createVisitorRequest,
    onSuccess: (visitor) => {
      void qc.invalidateQueries({ queryKey: securityKeys.all })
      toast.success(t('visitorRecorded', { name: visitor.fullName }))
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'VALIDATION_ERROR') {
        for (const d of err.details ?? []) {
          if (d.field in form.getValues() || d.field === 'documentType') {
            form.setError(d.field as keyof CreateVisitorInput, { type: 'server' })
          }
        }
        return
      }
      toast.error(tErr(err.code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('recordVisitor')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="visitor-name">{t('visitorName')}</Label>
          <Input
            id="visitor-name"
            autoFocus
            autoComplete="off"
            aria-invalid={!!errors.fullName}
            {...form.register('fullName')}
          />
          <FieldError>{errors.fullName && t('visitorNameInvalid')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="visitor-purpose">{t('visitorPurpose')}</Label>
          <Input
            id="visitor-purpose"
            autoComplete="off"
            placeholder={t('visitorPurposePlaceholder')}
            aria-invalid={!!errors.purpose}
            {...form.register('purpose')}
          />
          <FieldError>{errors.purpose && t('visitorPurposeInvalid')}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visitor-doc-type">{t('visitorDocument')}</Label>
            <Controller
              control={form.control}
              name="documentType"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_DOCUMENT}
                  onValueChange={(v) => {
                    const next = v === NO_DOCUMENT ? undefined : (v as VisitorDocumentTypeValue)
                    field.onChange(next)
                    if (!next) form.setValue('documentLast4', undefined)
                  }}
                >
                  <SelectTrigger
                    id="visitor-doc-type"
                    aria-invalid={!!errors.documentType}
                    aria-label={t('visitorDocument')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DOCUMENT}>{t('docTypeNone')}</SelectItem>
                    {VISITOR_DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {docLabel[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{errors.documentType && t('visitorDocTypeRequired')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visitor-doc-last4">{t('visitorDocLast4')}</Label>
            <Input
              id="visitor-doc-last4"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              placeholder="1234"
              disabled={!documentType}
              aria-invalid={!!errors.documentLast4}
              {...form.register('documentLast4', {
                setValueAs: (v: string) => (v?.trim() ? v.trim() : undefined),
              })}
            />
            <FieldError>{errors.documentLast4 && t('visitorDocLast4Invalid')}</FieldError>
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{t('visitorDocHint')}</p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="visitor-phone">{t('visitorPhone')}</Label>
          <Input
            id="visitor-phone"
            type="tel"
            autoComplete="off"
            placeholder="+7 700 000 00 00"
            aria-invalid={!!errors.phone}
            {...form.register('phone')}
          />
          <FieldError>{errors.phone && t('visitorPhoneInvalid')}</FieldError>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t('recordVisitorSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
