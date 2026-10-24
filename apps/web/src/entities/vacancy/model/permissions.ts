import { Role } from '@studenthub/shared-types'

// Кто решает, показать ли вакансию студентам. Зеркало @Roles на
// PATCH /career/university/vacancies/:id: декан очередь видит, но решений не принимает.
export const VACANCY_REVIEW_DECIDERS: readonly Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
]
