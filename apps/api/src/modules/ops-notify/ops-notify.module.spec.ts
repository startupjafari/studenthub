import { OPS_NOTIFIER } from '../../common/monitoring'
import { NoopOpsNotifier } from './noop-ops.notifier'
import { OpsNotifyModule } from './ops-notify.module'
import { OpsNotifyProcessor } from './ops-notify.processor'
import { OpsPolicyService } from './ops-policy.service'
import { OpsScheduleService } from './ops-schedule.service'
import { OpsStatusService } from './ops-status.service'
import { TelegramOpsNotifier } from './telegram-ops.notifier'

// docs/TELEGRAM_BOT.md §7.3.5, §7.5: «нет TELEGRAM_BOT_TOKEN — ни таймеров, ни вебхуков,
// ни фоновых запросов». Проверяется на составе провайдеров: воркер очереди — это фоновый
// процесс, и попасть в контейнер он не должен, сколько бы кода в модуле ни лежало.

function providerNames(providers: unknown[]): unknown[] {
  return providers.map((p) =>
    typeof p === 'object' && p !== null && 'useClass' in p
      ? (p as { useClass: unknown }).useClass
      : p,
  )
}

describe('OpsNotifyModule.register', () => {
  const original = process.env.TELEGRAM_BOT_TOKEN

  afterEach(() => {
    if (original === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = original
  })

  it('без токена: только заглушка порта — ни воркера, ни клиента Telegram', () => {
    delete process.env.TELEGRAM_BOT_TOKEN

    const module = OpsNotifyModule.register()
    const classes = providerNames(module.providers ?? [])

    expect(classes).toContain(NoopOpsNotifier)
    expect(classes).not.toContain(OpsNotifyProcessor)
    expect(classes).not.toContain(OpsPolicyService)
    // Планировщик проверок — это repeatable job'ы в Redis; без токена их заводить нельзя.
    expect(classes).not.toContain(OpsScheduleService)
    // Источник метрик тоже не поднимается: он тянет за собой полдюжины доменных сервисов.
    expect(classes).not.toContain(OpsStatusService)
  })

  it('пустая строка в переменной — это «не задано», а не «задано пустым»', () => {
    process.env.TELEGRAM_BOT_TOKEN = '   '

    expect(providerNames(OpsNotifyModule.register().providers ?? [])).toContain(NoopOpsNotifier)
  })

  it('с токеном поднимается полный состав, включая воркер очереди', () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:token'

    const classes = providerNames(OpsNotifyModule.register().providers ?? [])

    expect(classes).toContain(TelegramOpsNotifier)
    expect(classes).toContain(OpsNotifyProcessor)
    expect(classes).toContain(OpsScheduleService)
    expect(classes).toContain(OpsStatusService)
  })

  it('без токена не тянет за собой доменные модули ради сводки', () => {
    delete process.env.TELEGRAM_BOT_TOKEN

    expect(OpsNotifyModule.register().imports ?? []).toEqual([])
  })

  it('наружу в обоих случаях торчит только порт: прямого доступа к транспорту нет (§7.1.1)', () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    expect(OpsNotifyModule.register().exports).toEqual([OPS_NOTIFIER])

    process.env.TELEGRAM_BOT_TOKEN = '123456:token'
    expect(OpsNotifyModule.register().exports).toEqual([OPS_NOTIFIER])
  })
})
