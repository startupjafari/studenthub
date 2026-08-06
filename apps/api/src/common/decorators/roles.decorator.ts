import { SetMetadata } from '@nestjs/common'
import type { Role } from '@studenthub/shared-types'

export const ROLES_KEY = 'roles'

// Ограничивает эндпоинт списком ролей (проверяет RolesGuard).
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
