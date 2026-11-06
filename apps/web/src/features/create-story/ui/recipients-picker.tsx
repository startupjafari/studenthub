'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { STORY_AUDIENCE_USERS_MAX } from '@studenthub/shared-schemas'
import { Button, Modal } from '../../../shared/ui'
import { PeopleSearch } from './people-search'

/** Получатель аудитории «выбранные»: id для запроса и имя для чипа. */
export interface StoryRecipient {
  id: string
  name: string
}

/**
 * Получатели сторис для аудитории «выбранные». Выбор копится в окне и уходит наверх по
 * «Готово»: закрытие крестиком ничего не меняет. Удалённых и заблокированных сервер
 * отклонит при публикации — поиск их и так не показывает.
 */
export function RecipientsPicker({
  initial,
  onDone,
  onClose,
}: {
  initial: StoryRecipient[]
  onDone: (recipients: StoryRecipient[]) => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const [picked, setPicked] = useState<StoryRecipient[]>(initial)
  const chosen = new Set(picked.map((r) => r.id))
  const full = picked.length >= STORY_AUDIENCE_USERS_MAX

  function toggle(id: string, name: string): void {
    if (chosen.has(id)) setPicked(picked.filter((r) => r.id !== id))
    else if (!full) setPicked([...picked, { id, name }])
  }

  return (
    <Modal onClose={onClose} title={t('recipientsTitle')} size="md">
      <div className="flex flex-col gap-4">
        {picked.length > 0 && (
          <ul className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {picked.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-sm"
              >
                <span className="break-words">{r.name}</span>
                <button
                  type="button"
                  onClick={() => toggle(r.id, r.name)}
                  aria-label={t('recipientRemove', { name: r.name })}
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <PeopleSearch
          placeholder={t('recipientsSearch')}
          hint={t('recipientsHint', { max: STORY_AUDIENCE_USERS_MAX })}
          chosen={chosen}
          onPick={(p) => toggle(p.id, `${p.firstName} ${p.lastName}`)}
        />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={picked.length === 0} onClick={() => onDone(picked)}>
            {t('recipientsDone')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
