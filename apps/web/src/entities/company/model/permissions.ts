import { Role } from '@studenthub/shared-types'
import type { Company } from './types'

// Кто решает, допустить ли компанию к студентам вуза. Зеркало @Roles на
// PATCH /career/university/companies/:id: раздел «Компании» видят и декан, и модераторы,
// но решение за админом вуза (и платформой) — остальным кнопки вели в 403.
export const COMPANY_ACCESS_DECIDERS: readonly Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN]

/**
 * Владелец ли смотрящий своей компании. Профиль компании и заявки в вузы меняет только
 * OWNER (assertOwner в API): рекрутёру эти кнопки вели в 403. Пока карточка не загружена —
 * нет: кнопка, появившаяся позже, лучше кнопки, которая исчезает.
 */
export function isCompanyOwner(company: Pick<Company, 'memberRole'> | undefined): boolean {
  return company?.memberRole === 'OWNER'
}
