// Метаданные декораторов читаются через reflect-metadata: в unit-тестах main.ts,
// который подключает его в проде, не загружается.
import 'reflect-metadata'
import { Role } from '@studenthub/shared-types'
import { ROLES_KEY } from '../../common/decorators/roles.decorator'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { DocumentTypesController } from './document-types.controller'
import type { DocumentTypesService } from './document-types.service'

// Роли объявлены декораторами, и RolesGuard берёт @Roles класса, если у маршрута своего нет.
// Здесь закреплено, что каталог для выбора открыт всем, а управление — только админу вуза:
// вернуть @Roles на класс значит снова закрыть студенту выбор типа (D-F09).

function rolesOf(method: keyof DocumentTypesController): Role[] | undefined {
  const proto = DocumentTypesController.prototype
  return (Reflect.getMetadata(ROLES_KEY, proto[method]) ??
    Reflect.getMetadata(ROLES_KEY, DocumentTypesController)) as Role[] | undefined
}

function user(over: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 's1',
    role: Role.STUDENT,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
    ...over,
  }
}

describe('DocumentTypesController: доступ к каталогу (D-F09)', () => {
  it('каталог для выбора — без ограничения по роли', () => {
    expect(rolesOf('effective')).toBeUndefined()
  })

  it('управление каталогом — только админ вуза', () => {
    for (const method of ['list', 'addCustom', 'update', 'remove'] as const) {
      expect(rolesOf(method)).toEqual([Role.UNIVERSITY_ADMIN])
    }
  })

  it('вуз каталога берётся из токена', async () => {
    const effective = jest.fn().mockResolvedValue([])
    const controller = new DocumentTypesController({
      effective,
    } as unknown as DocumentTypesService)

    await controller.effective(user({ universityId: 'uni-7' }))
    expect(effective).toHaveBeenCalledWith('uni-7')

    // Платформенная роль без вуза получает статический каталог — так же проверяет сервер.
    await controller.effective(user({ role: Role.PLATFORM_ADMIN, universityId: null }))
    expect(effective).toHaveBeenLastCalledWith(null)
  })
})
