'use client'

import { CompanyProfile } from '../../../widgets/user-profile'

// Страница компании для вуза: открывается из карточки вакансии и с поста компании. Видна
// ролям вуза, одобрившего допуск компании; без допуска — «не найдена» (сервер отвечает 404).
export function CompanyPageView({ companyId }: { companyId: string }) {
  return <CompanyProfile companyId={companyId} />
}
