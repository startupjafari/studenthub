'use client'

import { useTranslations } from 'next-intl'
import { PageHeader } from '../../../shared/ui'
import { StudentIdPanel } from '../../../features/show-student-id'

// Прямая ссылка на студенческий (`/student-id`): в меню пункта нет, карту открывают из
// профиля, но адрес живёт — закладки и ярлыки на телефоне продолжают работать.
// Плашка ошибки — единственное содержимое страницы, и колонка отдаёт ей всю высоту `main`;
// карточке и скелету `flex-1` не нужен: в растянутой колонке они бы сжимались (§4).
export function StudentIdView() {
  const t = useTranslations('StudentId')

  return (
    <div className="flex w-full flex-col gap-6 has-[[data-empty-state]]:min-h-0 has-[[data-empty-state]]:flex-1">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <StudentIdPanel />
    </div>
  )
}
