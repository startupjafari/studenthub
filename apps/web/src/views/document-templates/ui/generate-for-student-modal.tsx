'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { Button, Modal } from '../../../shared/ui'
import { UserPicker, type PickedUser } from '../../../entities/user'

const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const

interface GenerateForStudentModalProps {
  pending: boolean
  onClose: () => void
  onGenerate: (studentId: string) => void
}

// Документ для конкретного студента. Сервер сам проверит, что студент из вашего вуза
// (у декана — факультета), и возьмёт данные из профиля; сюда уходит только id.
export function GenerateForStudentModal({
  pending,
  onClose,
  onGenerate,
}: GenerateForStudentModalProps) {
  const t = useTranslations('DocumentTemplates')
  const tCommon = useTranslations('Common')
  const [student, setStudent] = useState<PickedUser | null>(null)

  return (
    <Modal onClose={onClose} title={t('generateTitle')} size="lg">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{t('generateModalHint')}</p>
        <UserPicker
          value={student}
          onSelect={setStudent}
          roleFilter={STUDENT_ROLES}
          placeholder={t('pickStudent')}
          inline
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!student}
            loading={pending}
            onClick={() => student && onGenerate(student.id)}
          >
            <Download className="size-4" aria-hidden /> {t('generateButton')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
