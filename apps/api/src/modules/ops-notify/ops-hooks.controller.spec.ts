import { createHmac } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import type { RawBodyRequest } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../../common/exceptions/app.exception'
import { OPS_JOBS, QUEUES, type QueueService } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { OpsHooksController } from './ops-hooks.controller'

// docs/TELEGRAM_BOT.md §8: «Чужой запрос → 401». Эндпоинты публичные, поэтому проверка
// подписи здесь — вся защита, какая есть.

const SECRET = 'ops-hook-secret-value'

const railwayBody = {
  status: 'SUCCESS',
  service: { name: 'api' },
  deployment: { id: 'dep-1' },
}

function setup(secret: string | undefined = SECRET) {
  const queue = { enqueue: jest.fn(async () => undefined) }
  const config = { get: jest.fn(() => secret) }
  const controller = new OpsHooksController(
    config as unknown as ConfigService<EnvVars, true>,
    queue as unknown as QueueService,
  )
  return { controller, queue }
}

function request(raw: unknown = railwayBody): RawBodyRequest<FastifyRequest> {
  return { rawBody: Buffer.from(JSON.stringify(raw)) } as RawBodyRequest<FastifyRequest>
}

describe('OpsHooksController', () => {
  it('верный секрет — событие уходит в очередь, ответ не ждёт обработки', async () => {
    const { controller, queue } = setup()

    await controller.receive('railway', railwayBody, SECRET, undefined, undefined, request())

    expect(queue.enqueue).toHaveBeenCalledWith(QUEUES.OPS_NOTIFY, OPS_JOBS.EMIT, {
      event: 'deploySucceeded',
      data: { deploymentId: 'dep-1', service: 'api' },
    })
  })

  it('чужой запрос — 401 без деталей и без постановки в очередь', async () => {
    const { controller, queue } = setup()

    await expect(
      controller.receive('railway', railwayBody, 'подобранный', undefined, undefined, request()),
    ).rejects.toThrow(AppException)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('запрос без заголовка — тоже 401, неотличимо от неверного секрета', async () => {
    const { controller } = setup()

    await expect(
      controller.receive('railway', railwayBody, undefined, undefined, undefined, request()),
    ).rejects.toThrow(AppException)
  })

  it('секрет не настроен — вход закрыт, а не открыт всем', async () => {
    const { controller, queue } = setup(undefined)

    await expect(
      controller.receive('railway', railwayBody, undefined, undefined, undefined, request()),
    ).rejects.toThrow(AppException)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('неизвестный источник — 404, чтобы имена не перебирались по ответам', async () => {
    const { controller } = setup()

    await expect(
      controller.receive('gitlab', {}, SECRET, undefined, undefined, request({})),
    ).rejects.toThrow(AppException)
  })

  it('GitHub проверяется штатной подписью, а не общим заголовком', async () => {
    const body = { action: 'completed', workflow_run: { id: 1, conclusion: 'failure' } }
    const raw = Buffer.from(JSON.stringify(body))
    const signature = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`
    const { controller, queue } = setup()

    await controller.receive('github', body, undefined, signature, undefined, {
      rawBody: raw,
    } as RawBodyRequest<FastifyRequest>)

    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('GitHub с верным X-Ops-Secret, но без подписи — отказ', async () => {
    const { controller } = setup()

    await expect(
      controller.receive('github', {}, SECRET, undefined, undefined, request({})),
    ).rejects.toThrow(AppException)
  })

  it('слишком большое тело отклоняется до разбора', async () => {
    const { controller, queue } = setup()
    const huge = { rawBody: Buffer.alloc(200 * 1024) } as RawBodyRequest<FastifyRequest>

    await expect(
      controller.receive('railway', railwayBody, SECRET, undefined, undefined, huge),
    ).rejects.toThrow(AppException)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('апдейт Telegram проверяется своим secret_token, а не X-Ops-Secret', async () => {
    const body = { message: { chat: { id: -100 }, text: '/status' } }
    const { controller, queue } = setup()

    await controller.receive('telegram', body, undefined, undefined, SECRET, request(body))

    expect(queue.enqueue).toHaveBeenCalledWith(QUEUES.OPS_NOTIFY, OPS_JOBS.COMMAND, {
      command: 'status',
      argument: '',
      chatId: '-100',
    })
  })

  it('апдейт Telegram с чужим secret_token — 401', async () => {
    const { controller, queue } = setup()

    await expect(
      controller.receive('telegram', {}, SECRET, undefined, 'подобранный', request({})),
    ).rejects.toThrow(AppException)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('обычное сообщение в группе командой не считается и в очередь не идёт', async () => {
    const { controller, queue } = setup()
    const body = { message: { chat: { id: -100 }, text: 'деплой прошёл?' } }

    await controller.receive('telegram', body, undefined, undefined, SECRET, request(body))

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('неинтересное событие принимается, но в канал не идёт', async () => {
    const { controller, queue } = setup()

    await controller.receive(
      'railway',
      { status: 'REMOVED' },
      SECRET,
      undefined,
      undefined,
      request(),
    )

    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
