// ПЕРВЫЙ импорт — как в main.ts: Sentry.init до загрузки инструментируемых библиотек.
import './instrument'
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Logger as PinoLogger } from 'nestjs-pino'
import { WorkerModule } from './worker.module'

/**
 * Процесс-воркер медиа: `node dist/worker.js` (сервис studenthub-worker, тот же образ,
 * что у API). Обрабатывает очереди media-image и media-video; API при этом запускается с
 * MEDIA_PROCESSING=worker и только ставит задачи.
 *
 * Контекст приложения без HTTP-сервера: слушать порт воркеру нечего. Остановка по SIGTERM
 * закрывает воркеры BullMQ, и незаконченный job возвращается в очередь для другого процесса.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true })
  app.useLogger(app.get(PinoLogger))
  app.enableShutdownHooks()
  new Logger('Worker').log('Воркер медиа запущен: очереди media-image, media-video')
}

void bootstrap()
