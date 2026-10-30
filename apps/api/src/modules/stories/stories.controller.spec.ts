import { Role } from '@studenthub/shared-types'
import type { ConfigService } from '@nestjs/config'
import type { FastifyRequest } from 'fastify'
import { StoriesController } from './stories.controller'
import type { StoriesService } from './stories.service'
import type { EnvVars } from '../../config/env.schema'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'

const user = {
  sub: 'u-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: 'grp-1',
} as CurrentUserData
const req = { ip: '127.0.0.1', headers: {} } as FastifyRequest

function setup(enabled: boolean) {
  const stories = {
    feed: jest.fn().mockResolvedValue([{ author: { id: 'a' } }]),
    create: jest.fn().mockResolvedValue({ id: 's-1' }),
    getById: jest.fn().mockResolvedValue({ id: 's-1' }),
    markViewed: jest.fn().mockResolvedValue({ seen: true }),
    remove: jest.fn().mockResolvedValue(undefined),
  }
  const config = { get: jest.fn().mockReturnValue(enabled) }
  const controller = new StoriesController(
    stories as unknown as StoriesService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { controller, stories, config }
}

describe('StoriesController — флаг раскатки FEATURE_STORIES (E-F19)', () => {
  it('флаг читается из окружения', () => {
    const { config } = setup(true)
    expect(config.get).toHaveBeenCalledWith('FEATURE_STORIES', { infer: true })
  })

  it('включён — ручки работают как раньше', async () => {
    const { controller, stories } = setup(true)
    await expect(controller.feed(user, {})).resolves.toHaveLength(1)
    await controller.create(user, { audience: 'GROUP', text: 'Привет' }, req)
    expect(stories.create).toHaveBeenCalledTimes(1)
  })

  it('выключен — лента пустая, сервис не вызывается', async () => {
    const { controller, stories } = setup(false)
    await expect(controller.feed(user, {})).resolves.toEqual([])
    expect(stories.feed).not.toHaveBeenCalled()
  })

  it('выключен — публикация, просмотр и удаление отвечают NOT_FOUND', async () => {
    const { controller, stories } = setup(false)
    expect(() => controller.create(user, { audience: 'GROUP', text: 'Привет' }, req)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(() => controller.getById(user, 's-1')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    await expect(controller.markViewed(user, 's-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(controller.remove(user, 's-1', req)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(stories.create).not.toHaveBeenCalled()
    expect(stories.getById).not.toHaveBeenCalled()
    expect(stories.markViewed).not.toHaveBeenCalled()
    expect(stories.remove).not.toHaveBeenCalled()
  })
})
