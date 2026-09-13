import { Role } from '@studenthub/shared-types'
import { resolveUniversityScope } from './career-scope'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function viewer(role: Role, universityId: string | null = null): JwtPayload {
  return { sub: 'u1', role, universityId, facultyId: null, groupId: null }
}

describe('resolveUniversityScope — область данных карьерного центра', () => {
  it('платформенная роль без выбранного вуза получает понятный отказ, а не пустой список', () => {
    expect(() => resolveUniversityScope(viewer(Role.PLATFORM_ADMIN))).toThrow(
      'Выберите университет',
    )
  })

  it('платформенная роль работает в выбранном вузе', () => {
    expect(resolveUniversityScope(viewer(Role.PLATFORM_ADMIN), 'uni-7')).toBe('uni-7')
    expect(resolveUniversityScope(viewer(Role.PLATFORM_MODERATOR), 'uni-7')).toBe('uni-7')
  })

  it('сотрудник вуза работает в своём вузе, параметр не нужен', () => {
    expect(resolveUniversityScope(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'))).toBe('uni-1')
    expect(resolveUniversityScope(viewer(Role.DEAN, 'uni-1'), 'uni-1')).toBe('uni-1')
  })

  // Главное свойство параметра: он выбирает область данных, но не расширяет права.
  it('сотрудник вуза не может подменить вуз параметром', () => {
    expect(() => resolveUniversityScope(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'uni-2')).toThrow(
      'Ресурс другого университета',
    )
    expect(() => resolveUniversityScope(viewer(Role.STUDENT, 'uni-1'), 'uni-2')).toThrow(
      'Ресурс другого университета',
    )
  })

  it('роль без вуза и без права выбора получает WRONG_SCOPE', () => {
    expect(() => resolveUniversityScope(viewer(Role.STUDENT))).toThrow(
      'Нет доступа к этой области данных',
    )
  })
})
