import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { validateEnv } from './config/env.schema'
import { loggerConfig } from './common/logging/logger.config'
import { PrismaModule } from './common/prisma/prisma.module'
import { MinioModule } from './common/minio/minio.module'
import { QueueModule } from './common/queue/queue.module'
import { MediaModule } from './modules/media/media.module'

/**
 * Состав процесса-воркера (BACKEND_RULES §9.2: «отдельный процесс-воркер в production»).
 *
 * Только то, что нужно обработке медиа: конфиг, логи, БД, хранилище и очереди. Ни HTTP,
 * ни WebSocket, ни cron — расписание остаётся в API, иначе при двух процессах каждая
 * задача CleanupService шла бы дважды.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(loggerConfig),
    PrismaModule,
    MinioModule,
    QueueModule,
    MediaModule.register({ http: false, processors: true }),
  ],
})
export class WorkerModule {}
