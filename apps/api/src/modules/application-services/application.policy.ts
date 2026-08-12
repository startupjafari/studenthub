import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

// Права домена «Услуги университета». Единый источник истины для controller-guard, сервиса и scope
// (docs/PROJECT.md §2.2 матрица; ТЗ §21/§22/§25). Роль → набор действий; scope проверяется отдельно.
export type AppAction =
  | 'create'
  | 'read:self'
  | 'read:faculty'
  | 'read:university'
  | 'read:all'
  | 'cancel:self'
  | 'process'
  | 'assign'
  | 'comment:public'
  | 'comment:internal'
  | 'document:review'
  | 'result:create'
  | 'issue'
  | 'manage-services'

// Базовый набор студента — общий и для STUDENT, и для STAROSTA (§23: староста не теряет права студента).
const STUDENT_ACTIONS: AppAction[] = ['create', 'read:self', 'cancel:self', 'comment:public']

// Обработка на уровне вуза (UNIVERSITY_ADMIN/MODERATOR) и факультета (DEAN).
const STAFF_ACTIONS: AppAction[] = [
  'process',
  'assign',
  'comment:public',
  'comment:internal',
  'document:review',
  'result:create',
  'issue',
]

// docs/PROJECT.md §2.2: PLATFORM_ADMIN — чтение всех (не обрабатывает); PLATFORM_MODERATOR — нет доступа;
// TEACHER — нет доступа (§24). Староста = студент.
const ROLE_ACTIONS: Record<Role, AppAction[]> = {
  [Role.STUDENT]: STUDENT_ACTIONS,
  [Role.STAROSTA]: STUDENT_ACTIONS,
  [Role.TEACHER]: [],
  [Role.DEAN]: ['read:faculty', ...STAFF_ACTIONS],
  [Role.UNIVERSITY_MODERATOR]: ['read:university', ...STAFF_ACTIONS],
  [Role.UNIVERSITY_ADMIN]: ['read:university', 'manage-services', ...STAFF_ACTIONS],
  [Role.PLATFORM_ADMIN]: ['read:all', 'manage-services'],
  [Role.PLATFORM_MODERATOR]: [],
}

// Поля заявки, достаточные для scope-решений (без загрузки всей записи).
export interface AppScopeFields {
  studentId: string
  facultyId: string | null
  universityId: string
}

@Injectable()
export class ApplicationPolicy {
  can(role: Role, action: AppAction): boolean {
    return ROLE_ACTIONS[role]?.includes(action) ?? false
  }

  assert(role: Role, action: AppAction, message = 'Недостаточно прав'): void {
    if (!this.can(role, action)) {
      throw new AppException('FORBIDDEN', message)
    }
  }

  /** Prisma-where для списка по уровню доступа роли. `read:all` → без фильтра; нет доступа → заведомо пусто. */
  scopeWhere(viewer: JwtPayload): Prisma.ApplicationWhereInput {
    if (this.can(viewer.role, 'read:all')) return {}
    if (this.can(viewer.role, 'read:university') && viewer.universityId) {
      return { universityId: viewer.universityId }
    }
    if (this.can(viewer.role, 'read:faculty') && viewer.facultyId) {
      return { facultyId: viewer.facultyId }
    }
    if (this.can(viewer.role, 'read:self')) return { studentId: viewer.sub }
    // Нет ни одного read-права → ничего не возвращаем (защита от IDOR на списке).
    return { id: '__none__' }
  }

  /** Может ли зритель ЧИТАТЬ конкретную заявку (§22: тот же scope на detail/файлы/комменты). */
  canRead(viewer: JwtPayload, app: AppScopeFields): boolean {
    if (this.can(viewer.role, 'read:all')) return true
    if (this.can(viewer.role, 'read:university')) return app.universityId === viewer.universityId
    if (this.can(viewer.role, 'read:faculty')) return app.facultyId === viewer.facultyId
    if (this.can(viewer.role, 'read:self')) return app.studentId === viewer.sub
    return false
  }

  assertCanRead(viewer: JwtPayload, app: AppScopeFields): void {
    if (!this.canRead(viewer, app)) {
      throw new AppException('WRONG_SCOPE', 'Заявка вне вашей области доступа')
    }
  }

  /** Может ли зритель ОБРАБАТЫВАТЬ заявку: право process + scope (факультет/вуз). */
  canProcess(viewer: JwtPayload, app: AppScopeFields): boolean {
    if (!this.can(viewer.role, 'process')) return false
    if (this.can(viewer.role, 'read:university')) return app.universityId === viewer.universityId
    if (this.can(viewer.role, 'read:faculty')) return app.facultyId === viewer.facultyId
    return false
  }

  assertCanProcess(viewer: JwtPayload, app: AppScopeFields): void {
    if (!this.canProcess(viewer, app)) {
      throw new AppException('FORBIDDEN', 'Нет прав на обработку этой заявки')
    }
  }
}
