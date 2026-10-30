import { Role } from '@studenthub/shared-types'

// Кого можно поставить преподавателем пары или заменяющим — как на сервере
// (`assertAssignableTeacher`): преподавателя или декана своего вуза. Декан тоже ведёт пары.
export const PAIR_TEACHER_ROLES: readonly Role[] = [Role.TEACHER, Role.DEAN]
