import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client as MinioClient } from 'minio'
import type { EnvVars } from '../../config/env.schema'
import { MINIO_CLIENT } from './minio.constants'
import { MinioBucketsService } from './minio-buckets.service'

export { MINIO_CLIENT }

// Глобальный MinIO-клиент. Используется health-индикатором и FileService (Фаза 2).
// MinioBucketsService создаёт бакеты и применяет политики на старте.
@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        new MinioClient({
          endPoint: config.get('MINIO_ENDPOINT', { infer: true }),
          port: config.get('MINIO_PORT', { infer: true }),
          useSSL: config.get('MINIO_USE_SSL', { infer: true }),
          accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
          secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
        }),
    },
    MinioBucketsService,
  ],
  exports: [MINIO_CLIENT],
})
export class MinioModule {}
