'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { DOCUMENT_CATEGORIES } from '@studenthub/shared-config'
import { DOCUMENT_FIELD_VALUES } from '@studenthub/shared-schemas'
import {
  Button,
  Checkbox,
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
import { createCustomDocumentType, documentTypeKeys } from '../../../entities/document-type'

interface Props {
  onClose: () => void
  onErr: (e: unknown) => void
}

// Добавление своего типа документа. Форма раскрывалась прямо на странице и отжимала
// таблицу вниз, хотя своих типов вуз заводит единицы, а список смотрит постоянно.
export function CreateDocumentTypeModal({ onClose, onErr }: Props) {
  const t = useTranslations('Documents')
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0])
  const [label, setLabel] = useState('')
  const [fields, setFields] = useState<string[]>([])
  const [retention, setRetention] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const mut = useMutation({
    mutationFn: () =>
      createCustomDocumentType({
        code: code.trim().toUpperCase(),
        category: category as 'PERSONAL',
        label: label.trim(),
        fields: fields as 'number'[],
        retentionDays: retention.trim() ? Number(retention.trim()) : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentTypeKeys.all })
      toast.success(t('dt_created'))
      onClose()
    },
    onError: onErr,
  })

  const codeError = code.trim().length < 2 ? t('dt_codeHint') : null
  const labelError = label.trim().length === 0 ? t('dt_labelHint') : null

  return (
    <Modal onClose={onClose} title={t('dt_addCustom')} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(true)
          if (!codeError && !labelError) mut.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dt-code">{t('dt_code')}</Label>
            <Input
              id="dt-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CLUB_CARD"
              aria-invalid={submitted && !!codeError}
            />
            <FieldError>{submitted ? codeError : null}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dt-label">{t('dt_label')}</Label>
            <Input
              id="dt-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-invalid={submitted && !!labelError}
            />
            <FieldError>{submitted ? labelError : null}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('dt_category')}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`docCat_${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dt-ret">{t('dt_retention')}</Label>
            <Input
              id="dt-ret"
              type="number"
              min={0}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              placeholder={t('dt_days')}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('dt_fields')}</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DOCUMENT_FIELD_VALUES.map((f) => (
              <label key={f} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Checkbox
                  checked={fields.includes(f)}
                  onCheckedChange={(v) =>
                    setFields((prev) => (v === true ? [...prev, f] : prev.filter((x) => x !== f)))
                  }
                />
                {t(`dt_field_${f}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('dt_cancel')}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t('dt_add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
