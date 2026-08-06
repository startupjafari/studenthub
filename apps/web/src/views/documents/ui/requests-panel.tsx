'use client'

import { useTranslations } from 'next-intl'
import { ClipboardList } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { EmptyState } from '../../../shared/ui'
import { StaffRequests } from './staff-requests'
import { StudentRequests } from './student-requests'

// Ролевая матрица §15.2 (15.18): деканат/студ.офис и преподаватель создают/проверяют запросы;
// студент/староста — отвечают; админ вуза и платформенные роли в запросах не участвуют.
const STAFF_ROLES: ReadonlySet<Role> = new Set([Role.DEAN, Role.UNIVERSITY_MODERATOR, Role.TEACHER])
const RESPONDER_ROLES: ReadonlySet<Role> = new Set([Role.STUDENT, Role.STAROSTA])

// Раздел «Запросы университета» (Ф15C/D, 15.17–15.18): ветвление по роли.
export function RequestsPanel() {
  const t = useTranslations('Documents')
  const role = useAppSelector((s) => s.auth.role)
  if (role && STAFF_ROLES.has(role)) return <StaffRequests />
  if (role && RESPONDER_ROLES.has(role)) return <StudentRequests />
  return (
    <EmptyState
      icon={<ClipboardList className="size-6" aria-hidden />}
      title={t('req_notApplicable')}
    />
  )
}
