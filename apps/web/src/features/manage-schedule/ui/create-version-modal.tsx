'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { createScheduleRequest, scheduleKeys } from '../../../entities/schedule'
import { Button, Input, Label, Modal } from '../../../shared/ui'
import { useErrorToast } from '../../../shared/lib'

/**
 * Новая версия расписания группы.
 *
 * Раньше форма разворачивалась полосой под шапкой и сдвигала календарь вниз — ради
 * действия, которое делают раз в семестр. Теперь это модалка, как и остальные
 * создания в системе.
 *
 * Если у группы уже есть активное расписание, новая версия создаётся черновиком (C-F13):
 * сетку следующего семестра готовят заранее, и сразу активная пустая версия снимала бы
 * действующее расписание у студентов и преподавателей. Публикует её «Сделать активным».
 * Первая версия группы становится активной сразу — заменять ей нечего.
 */
export function CreateVersionModal({
  groupId,
  hasActive,
  onCreated,
  onClose,
}: {
  groupId: string
  /** У группы уже есть активная версия — новую создаём черновиком. */
  hasActive: boolean
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Schedule')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { show } = useErrorToast('schedule-version')
  const [name, setName] = useState('')

  const createVersion = useMutation({
    mutationFn: () => createScheduleRequest({ groupId, name: name.trim(), isActive: !hasActive }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.containers(groupId) })
      onCreated(created.id)
      toast.success(t('containerCreated'))
      onClose()
    },
    onError: (e) => show(e),
  })

  return (
    <Modal onClose={onClose} title={t('createContainer')} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) createVersion.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-name">{t('newContainerName')}</Label>
          <Input
            id="v-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newContainerPlaceholder')}
          />
          {hasActive && (
            <p className="text-xs text-muted-foreground">{t('newContainerDraftHint')}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createVersion.isPending} disabled={!name.trim()}>
            {t('createContainer')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
