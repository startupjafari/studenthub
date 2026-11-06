import { Agent } from './agent.js'
import { loadConfig } from './config.js'
import { loadOrCreateKey } from './keys.js'
import { log } from './log.js'

// Точка входа агента камер. Ошибка настройки — выход с кодом 1 и понятной строкой в
// журнале: Docker перезапустит контейнер, а админ увидит причину в `docker logs`.
try {
  const config = loadConfig()
  const key = loadOrCreateKey(config.stateDir)
  const agent = new Agent(config, key)
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info('Остановка агента', { signal })
      agent.stop()
      process.exit(0)
    })
  }
  await agent.run()
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
