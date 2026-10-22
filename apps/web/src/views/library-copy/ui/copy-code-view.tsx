'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookX } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { PageLoader, StatusScreen } from '../../../shared/ui'
import { useAppSelector } from '../../../shared/store'
import { fetchBookCopyByCode, libraryKeys } from '../../../entities/library'

// Страница QR-наклейки экземпляра (`/c/<код>`, Фаза 20.3). QR ведёт сюда, а не содержит
// данные (BACKEND_RULES §13.2). Кто открыл — туда и ведём: библиотекарь и админ вуза — к
// книге в фонде с выделенным экземпляром, студент — к книге в каталоге, где её можно
// забронировать.

export function CopyCodeView({ code }: { code: string }) {
  const t = useTranslations('LibraryCatalog')
  const router = useRouter()
  const role = useAppSelector((s) => s.auth.role)
  const copy = useQuery({
    queryKey: libraryKeys.copyByCode(code),
    queryFn: () => fetchBookCopyByCode(code),
    retry: false,
  })

  useEffect(() => {
    if (!copy.data || !role) return
    const bookId = copy.data.book.id
    const target =
      role === Role.LIBRARIAN
        ? `/library/catalog/${bookId}`
        : role === Role.UNIVERSITY_ADMIN
          ? `/university-admin/library/catalog/${bookId}`
          : `/books/${bookId}`
    router.replace(target)
  }, [copy.data, role, router])

  if (copy.isError) {
    return (
      <StatusScreen
        icon={BookX}
        title={t('copyNotFoundTitle')}
        description={t('copyNotFoundDesc')}
      />
    )
  }
  return <PageLoader label={t('openingBook')} />
}
