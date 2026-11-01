'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UpdateStoryAudienceSchema } from '@studenthub/shared-schemas'
import { useFormAlert } from '../../../shared/lib'
import { storyKeys, updateStoryAudienceRequest, type StoryCard } from '../../../entities/story'
import { Button, FormAlert, Modal } from '../../../shared/ui'
import { StoryAudienceFields, type StoryAudienceState } from './audience-fields'

/**
 * Смена аудитории своей живой сторис. Сервер читает аудиторию на каждом запросе, поэтому
 * новый круг действует сразу — об этом и говорит подсказка: выбывшие сторис не откроют.
 * Группу и факультет выдача не возвращает — их подставляет сервер из профиля автора,
 * если роль не выбирает их сама.
 */
export function ChangeAudienceModal({
  story,
  onClose,
  onSaved,
}: {
  story: StoryCard
  onClose: () => void
  onSaved?: (updated: StoryCard) => void
}) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { error, show, reset } = useFormAlert()
  const [value, setValue] = useState<StoryAudienceState>({
    audience: story.audience,
    recipients: (story.audienceUsers ?? []).map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
    })),
  })
  const [needRecipients, setNeedRecipients] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      updateStoryAudienceRequest(
        story.id,
        UpdateStoryAudienceSchema.parse({
          audience: value.audience,
          ...(value.groupId ? { groupId: value.groupId } : {}),
          ...(value.facultyId ? { facultyId: value.facultyId } : {}),
          ...(value.audience === 'SELECTED' ? { userIds: value.recipients.map((r) => r.id) } : {}),
        }),
      ),
    onMutate: () => reset(),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      toast.success(t('audienceSaved'))
      onSaved?.(updated)
      onClose()
    },
    onError: (e) => show(e),
  })

  return (
    <Modal onClose={onClose} title={t('audienceTitle')} size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.audience === 'SELECTED' && value.recipients.length === 0) {
            setNeedRecipients(true)
            return
          }
          save.mutate()
        }}
      >
        <FormAlert error={error} />
        <div className="flex flex-wrap items-start gap-2">
          <StoryAudienceFields
            value={value}
            onChange={(next) => {
              setValue(next)
              setNeedRecipients(false)
            }}
            recipientsError={needRecipients ? t('recipientsNeed') : undefined}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('audienceHint')}</p>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {tCommon('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
