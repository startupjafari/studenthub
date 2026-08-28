import type { SchedulerRegistry } from '@nestjs/schedule'
import type { OpsNotifier } from '../../../common/monitoring'
import type { OpsPolicyService } from '../ops-policy.service'
import { CronSilenceCheck } from './cron-silence.check'

// T-5 (docs/TELEGRAM_BOT.md §8): «Пропуск двух окон подряд → 🟡».

const MINUTE = 60_000

/** Задача с заданным периодом и моментом последнего срабатывания. */
function makeJob(periodMs: number, lastExecution: Date | null) {
  const base = Date.now() + periodMs
  return {
    lastExecution,
    lastDate: () => lastExecution,
    nextDates: (count: number) =>
      Array.from({ length: count }, (_, i) => ({ toMillis: () => base + i * periodMs })),
  }
}

/**
 * Политика в тесте ведёт себя как настоящая: сообщает только о СМЕНЕ состояния, а первое
 * наблюдение «всё хорошо» проглатывает. Мок, всегда возвращающий true, проверял бы не то —
 * с ним «задача идёт по расписанию» тоже породила бы сообщение.
 */
function makePolicy() {
  const states = new Map<string, string>()
  return {
    states,
    transitioned: jest.fn(async (key: string, state: string, healthy: string) => {
      const previous = states.get(key)
      states.set(key, state)
      return previous === undefined ? state !== healthy : previous !== state
    }),
  }
}

function setup(jobs: Record<string, ReturnType<typeof makeJob>>) {
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const policy = makePolicy()
  const scheduler = {
    getCronJobs: () => new Map(Object.entries(jobs)),
  } as unknown as SchedulerRegistry
  const check = new CronSilenceCheck(scheduler, policy as unknown as OpsPolicyService, ops)
  return { check, ops, policy, scheduler }
}

/** Проверка не судит, пока приложение не прожило два окна — состариваем её «старт». */
function aged(check: CronSilenceCheck, ms: number): CronSilenceCheck {
  Object.defineProperty(check, 'startedAt', { value: Date.now() - ms })
  return check
}

describe('CronSilenceCheck', () => {
  it('пропуск двух окон подряд — 🟡 с именем задачи и периодом', async () => {
    const { check, ops } = setup({
      publishScheduledPosts: makeJob(MINUTE, new Date(Date.now() - 10 * MINUTE)),
    })

    await aged(check, 30 * MINUTE).run()

    expect(ops.emit).toHaveBeenCalledWith(
      'cronSilent',
      expect.objectContaining({ job: 'publishScheduledPosts', period: '60 с' }),
    )
  })

  it('задача идёт по расписанию — тишина в канале', async () => {
    const { check, ops } = setup({
      publishScheduledPosts: makeJob(MINUTE, new Date(Date.now() - 30_000)),
    })

    await aged(check, 30 * MINUTE).run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('редкие задачи не наблюдаются: у недельной чистки «два окна» — это две недели', async () => {
    const { check, ops, policy } = setup({
      cleanAuditLogs: makeJob(7 * 24 * 60 * MINUTE, new Date(Date.now() - 30 * 24 * 60 * MINUTE)),
    })

    await aged(check, 365 * 24 * 60 * MINUTE).run()

    expect(policy.transitioned).not.toHaveBeenCalled()
    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('только что поднявшееся приложение молчит — задача просто ещё не наступала', async () => {
    const { check, ops } = setup({ publishScheduledPosts: makeJob(MINUTE, null) })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('повторная проверка при той же аварии сообщение не дублирует', async () => {
    const { check, ops } = setup({
      publishScheduledPosts: makeJob(MINUTE, new Date(Date.now() - 10 * MINUTE)),
    })
    const ready = aged(check, 30 * MINUTE)

    await ready.run()
    await ready.run()

    expect(ops.emit).toHaveBeenCalledTimes(1)
  })

  it('возвращение к расписанию приходит отдельным 🟢', async () => {
    const jobs = { publishScheduledPosts: makeJob(MINUTE, new Date(Date.now() - 10 * MINUTE)) }
    const { check, ops } = setup(jobs)
    const ready = aged(check, 30 * MINUTE)

    await ready.run()
    jobs.publishScheduledPosts = makeJob(MINUTE, new Date(Date.now() - 10_000))
    await ready.run()

    expect(ops.emit).toHaveBeenNthCalledWith(1, 'cronSilent', expect.anything())
    expect(ops.emit).toHaveBeenNthCalledWith(2, 'cronResumed', { job: 'publishScheduledPosts' })
  })
})
