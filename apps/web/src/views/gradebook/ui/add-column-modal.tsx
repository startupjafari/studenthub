'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { GRADE_COLUMN_KINDS, CreateGradeColumnSchema } from '@studenthub/shared-schemas'
import {
  Button,
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
import { gradebookKeys, createColumnRequest } from '../../../entities/gradebook'

interface Props {
  courseId: string
  onClose: () => void
}

// Модалка добавления контрольной точки (колонки журнала).
export function AddColumnModal({ courseId, onClose }: Props) {
  const t = useTranslations('Gradebook')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<(typeof GRADE_COLUMN_KINDS)[number]>('LAB')
  const [maxScore, setMaxScore] = useState('100')
  const [pending, setPending] = useState(false)
  const [titleError, setTitleError] = useState(false)

  async function onSubmit() {
    const payload = {
      courseId,
      title: title.trim(),
      kind,
      ...(maxScore ? { maxScore: Number(maxScore) } : {}),
    }
    const parsed = CreateGradeColumnSchema.safeParse(payload)
    if (!parsed.success) {
      setTitleError(!title.trim())
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createColumnRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: gradebookKeys.course(courseId) })
      toast.success(t('columnAdded'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('newColumn')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="col-title">{t('columnTitle')}</Label>
          <Input
            id="col-title"
            placeholder={t('columnTitlePlaceholder')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleError(false)
            }}
            autoFocus
          />
          {titleError && <p className="text-sm text-destructive">{t('required')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('kind')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADE_COLUMN_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kind_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="col-max">{t('maxScore')}</Label>
            <Input
              id="col-max"
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending}>
            {t('add')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
