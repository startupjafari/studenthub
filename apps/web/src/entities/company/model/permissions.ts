import { Role } from '@studenthub/shared-types'

// Кто решает, допустить ли компанию к студентам вуза. Зеркало @Roles на
// PATCH /career/university/companies/:id: раздел «Компании» видят и декан, и модераторы,
// но решение за админом вуза (и платформой) — остальным кнопки вели в 403.
export const COMPANY_ACCESS_DECIDERS: readonly Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN]
