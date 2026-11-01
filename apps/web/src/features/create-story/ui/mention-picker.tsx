'use client'

import { useTranslations } from 'next-intl'
import { Modal } from '../../../shared/ui'
import { PeopleSearch } from './people-search'

/**
 * Выбор человека для отметки на кадре. Подойдёт ли человек под аудиторию сторис, решает
 * сервер при публикации — здесь об этом предупреждает подсказка.
 */
export function MentionPicker({
  onPick,
  onClose,
}: {
  onPick: (userId: string, name: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <Modal onClose={onClose} title={t('mentionTitle')} size="md">
      <PeopleSearch
        placeholder={t('mentionSearch')}
        hint={t('mentionHint')}
        onPick={(p) => onPick(p.id, `${p.firstName} ${p.lastName}`)}
      />
    </Modal>
  )
}
