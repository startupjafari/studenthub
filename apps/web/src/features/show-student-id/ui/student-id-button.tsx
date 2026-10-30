'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { IdCard } from 'lucide-react'
import { Button, Modal } from '../../../shared/ui'
import { StudentIdPanel } from './student-id-panel'

/**
 * Кнопка «Студенческий» в своём профиле: карта и QR открываются окном поверх профиля —
 * отдельного пункта в меню у студенческого больше нет. Запрос карты и QR идёт только пока
 * окно открыто: без него профиль не дёргал бы `/student-id/me` каждые 45 секунд.
 */
export function StudentIdButton({ className }: { className?: string }) {
  const t = useTranslations('StudentId')
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('open')}
        onClick={() => setOpen(true)}
        className={className}
      >
        <IdCard className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t('open')}</span>
      </Button>

      {open && (
        <Modal onClose={() => setOpen(false)} title={t('title')} size="3xl">
          <StudentIdPanel />
        </Modal>
      )}
    </>
  )
}
