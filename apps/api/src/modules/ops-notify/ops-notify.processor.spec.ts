import type Redis from 'ioredis'
import type { Job } from 'bullmq'
import { OPS_JOBS } from '../../common/queue'
import type { OpsNotifier } from '../../common/monitoring'
import type { DeployTrackerService } from './deploy-tracker.service'
import type { OpsMessage } from './ops-message.builder'
import { OpsNotifyProcessor } from './ops-notify.processor'
import type { OpsPolicyService } from './ops-policy.service'
import type { TelegramOpsService } from './telegram-ops.service'

// T-7 (docs/TELEGRAM_BOT.md §8): «на релиз в канале одна строка, статус меняется правкой;
// message_id переживает рестарт».

function setup(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  const telegram = {
    send: jest.fn(async (_message: OpsMessage) => 55 as number | null),
    edit: jest.fn(async (_id: number, _message: OpsMessage) => 'ok' as 'ok' | 'gone' | 'failed'),
  }
  const notifier: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const deploys = { onDeployEvent: jest.fn(async () => undefined) }
  const noCheck = { run: jest.fn(async () => undefined) }

  const processor = new OpsNotifyProcessor(
    telegram as unknown as TelegramOpsService,
    { quietUntil: jest.fn(), endQuiet: jest.fn() } as unknown as OpsPolicyService,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    noCheck as never,
    deploys as unknown as DeployTrackerService,
    { handle: jest.fn(async () => undefined) } as never,
    redis as unknown as Redis,
    notifier,
  )
  return { processor, telegram, notifier, deploys, store }
}

const job = (name: string, data: object): Job =>
  ({ name, data: { ...data, _meta: {} } }) as unknown as Job

const deployMessage = (text: string): OpsMessage => ({
  text,
  buttons: [],
  silent: false,
  editKey: 'deploymentId:dep-1',
})

describe('OpsNotifyProcessor — доставка', () => {
  it('сообщение без editKey просто отправляется', async () => {
    const { processor, telegram } = setup()

    await processor.process(
      job(OPS_JOBS.SEND, { message: { text: 'x', buttons: [], silent: false } }),
    )

    expect(telegram.send).toHaveBeenCalledTimes(1)
  })

  it('первый статус деплоя отправляется, message_id запоминается', async () => {
    const { processor, telegram, store } = setup()

    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🟡 начался') }))

    expect(telegram.send).toHaveBeenCalledTimes(1)
    expect(store.get('ops:msg:deploymentId:dep-1')).toBe('55')
  })

  it('следующий статус ПРАВИТ то же сообщение — в канале одна строка на релиз', async () => {
    const { processor, telegram } = setup()
    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🟡 начался') }))
    telegram.send.mockClear()

    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🟢 прошёл') }))

    expect(telegram.edit).toHaveBeenCalledWith(55, expect.objectContaining({ text: '🟢 прошёл' }))
    expect(telegram.send).not.toHaveBeenCalled()
  })

  it('message_id переживает рестарт: берётся из Redis, а не из памяти процесса', async () => {
    const { processor, telegram } = setup({ 'ops:msg:deploymentId:dep-1': '7' })

    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🔴 упал') }))

    expect(telegram.edit).toHaveBeenCalledWith(7, expect.anything())
    expect(telegram.send).not.toHaveBeenCalled()
  })

  it('сообщения больше нет — отправляем новое, а не теряем событие', async () => {
    const { processor, telegram, store } = setup({ 'ops:msg:deploymentId:dep-1': '7' })
    telegram.edit.mockResolvedValueOnce('gone')

    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🔴 упал') }))

    expect(telegram.send).toHaveBeenCalledTimes(1)
    expect(store.get('ops:msg:deploymentId:dep-1')).toBe('55')
  })

  it('сеть моргнула — второй строки о том же деплое не появляется', async () => {
    const { processor, telegram } = setup({ 'ops:msg:deploymentId:dep-1': '7' })
    telegram.edit.mockResolvedValueOnce('failed')

    await processor.process(job(OPS_JOBS.SEND, { message: deployMessage('🔴 упал') }))

    expect(telegram.send).not.toHaveBeenCalled()
  })
})

describe('OpsNotifyProcessor — событие из вебхука', () => {
  it('эмитит событие и даёт трекеру дополнить его', async () => {
    const { processor, notifier, deploys } = setup()
    const data = { deploymentId: 'dep-1', service: 'api' }

    await processor.process(job(OPS_JOBS.EMIT, { event: 'deploySucceeded', data }))

    expect(notifier.emit).toHaveBeenCalledWith('deploySucceeded', data)
    expect(deploys.onDeployEvent).toHaveBeenCalledWith('deploySucceeded', data)
  })

  it('неизвестный job не роняет воркер', async () => {
    const { processor } = setup()

    await expect(processor.process(job('ops-неизвестный', {}))).resolves.toBeUndefined()
  })
})
