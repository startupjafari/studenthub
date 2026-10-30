import { Role, RESTRICTED_ROLES } from '@studenthub/shared-types'
import { describe, expect, it } from 'vitest'
import { ROLE_HOME, isRestrictedRolePath } from './routes'

// Middleware уводит роль с запретом по умолчанию на её главную со всех путей вне списка.
// Ошибка здесь — либо охрана и библиотекарь видят стену 403 на чужих экранах, либо
// middleware не пускает их на собственную главную и зацикливает редирект.

describe('isRestrictedRolePath', () => {
  it('главная каждой ограниченной роли открыта ей самой', () => {
    for (const role of RESTRICTED_ROLES) {
      expect(isRestrictedRolePath(role, ROLE_HOME[role]), role).toBe(true)
      expect(isRestrictedRolePath(role, '/settings'), role).toBe(true)
      expect(isRestrictedRolePath(role, '/setup-2fa'), role).toBe(true)
    }
  })

  it('свой профиль открыт, чужой — нет', () => {
    for (const role of RESTRICTED_ROLES) {
      expect(isRestrictedRolePath(role, '/profile'), role).toBe(true)
      expect(isRestrictedRolePath(role, '/profile/abc'), role).toBe(false)
    }
  })

  it('библиотекарю закрыты чужие разделы, в том числе раздел охраны', () => {
    for (const path of [
      '/',
      '/schedule',
      '/chats',
      '/profile/abc',
      '/security',
      '/verify-id',
      '/r/abc',
    ]) {
      expect(isRestrictedRolePath(Role.LIBRARIAN, path), path).toBe(false)
    }
    expect(isRestrictedRolePath(Role.LIBRARIAN, '/library/catalog')).toBe(true)
  })

  it('охране закрыта библиотека', () => {
    expect(isRestrictedRolePath(Role.SECURITY_GUARD, '/library')).toBe(false)
    expect(isRestrictedRolePath(Role.SECURITY_GUARD, '/security/cameras')).toBe(true)
  })

  it('префикс сравнивается по сегменту, а не по строке', () => {
    expect(isRestrictedRolePath(Role.LIBRARIAN, '/library-admin')).toBe(false)
  })

  it('остальных ролей ограничение не касается', () => {
    for (const role of Object.values(Role).filter((r) => !RESTRICTED_ROLES.includes(r))) {
      expect(isRestrictedRolePath(role, '/security'), role).toBe(true)
      expect(isRestrictedRolePath(role, '/library'), role).toBe(true)
    }
  })
})
