import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { MaintenanceGuard } from './maintenance.guard'
import { AppException } from '../exceptions/app.exception'
import type { PlatformService } from '../../modules/platform/platform.service'

function context(user?: { role: Role }): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext
}

function setup(active: boolean, exempt = false) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(exempt || undefined) }
  const platform = { maintenanceActive: jest.fn().mockResolvedValue(active) }
  const guard = new MaintenanceGuard(
    reflector as unknown as Reflector,
    platform as unknown as PlatformService,
  )
  return { guard, platform }
}

describe('MaintenanceGuard', () => {
  it('пропускает всех, пока техработ нет', async () => {
    const { guard } = setup(false)

    await expect(guard.canActivate(context())).resolves.toBe(true)
  })

  it('останавливает обычного пользователя во время техработ', async () => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context({ role: Role.STUDENT }))).rejects.toThrow(AppException)
  })

  it('останавливает и неаутентифицированного', async () => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context())).rejects.toThrow(AppException)
  })

  // Те, кто чинит, обязаны продолжать работать — иначе режим некому снять.
  it.each([Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR])('пропускает %s', async (role) => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context({ role }))).resolves.toBe(true)
  })

  it('не пропускает администратора вуза — он платформу не чинит', async () => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context({ role: Role.UNIVERSITY_ADMIN }))).rejects.toThrow(
      AppException,
    )
  })

  // Список исключений — это список того, без чего режим не снять (вход, мини-апп, health).
  it('пропускает маршрут с @MaintenanceExempt(), не спрашивая состояние', async () => {
    const { guard, platform } = setup(true, true)

    await expect(guard.canActivate(context({ role: Role.STUDENT }))).resolves.toBe(true)
    expect(platform.maintenanceActive).not.toHaveBeenCalled()
  })

  it('отдаёт код MAINTENANCE со статусом 503', async () => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context({ role: Role.STUDENT }))).rejects.toMatchObject({
      code: 'MAINTENANCE',
      status: 503,
    })
  })
})
