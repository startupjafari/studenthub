import { SetMetadata } from '@nestjs/common'

export const SCOPE_KEY = 'scope'

export type ScopeLevel = 'university' | 'faculty' | 'group'

export interface ScopeConfig {
  /** Уровень scope: сверяется с universityId/facultyId/groupId из токена. */
  level: ScopeLevel
  /** Откуда брать идентификатор ресурса. По умолчанию params. */
  source?: 'params' | 'query' | 'body'
  /** Имя поля с идентификатором ресурса. По умолчанию `${level}Id`. */
  param?: string
}

// Помечает, что ScopeGuard должен сверить scope ресурса со scope пользователя из токена.
// Guard — первый барьер; сервис ОБЯЗАН дополнительно проверить фактическую принадлежность (§6.1).
export const Scope = (config: ScopeConfig) => SetMetadata(SCOPE_KEY, config)
