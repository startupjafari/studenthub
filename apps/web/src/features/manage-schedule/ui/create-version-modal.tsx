'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { createScheduleRequest, scheduleKeys } from '../../../entities/schedule'
import { Button, FormAlert, Input, Label, Modal } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

/**
 * Новая версия расписания группы.
 *
 * Раньше форма разворачивалась полосой под шапкой и сдвигала календарь вниз — ради
 * действия, которое делают раз в семестр. Теперь это модалка, как и остальные
 * создания в системе.
 */
export function CreateVersionModal({
  groupId,
  onCreated,
  onClose,
}: {
  groupId: string
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Schedule')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { error, show, reset } = useFormAlert()
  const [name, setName] = useState('')

  const createVersion = useMutation({
    mutationFn: () => createScheduleRequest({ groupId, name: name.trim() }),
    onMutate: () => reset(),
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
        <FormAlert error={error} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-name">{t('newContainerName')}</Label>
          <Input
            id="v-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newContainerPlaceholder')}
          />
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
