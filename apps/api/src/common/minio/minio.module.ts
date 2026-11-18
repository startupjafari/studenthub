import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client as MinioClient } from 'minio'
import type { EnvVars } from '../../config/env.schema'
import { MINIO_CLIENT, MINIO_PUBLIC_CLIENT } from './minio.constants'
import { MinioBucketsService } from './minio-buckets.service'

export { MINIO_CLIENT, MINIO_PUBLIC_CLIENT }

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
          region: config.get('MINIO_REGION', { infer: true }),
        }),
    },
    {
      // Клиент для presigned-ссылок в браузер: если задан MINIO_PUBLIC_ENDPOINT —
      // подписываем на публичный адрес, иначе повторяем внутренний (dev без изменений).
      // Регион задан явно: без него minio-js перед КАЖДОЙ подписью идёт по сети на этот
      // адрес узнать регион бакета. Публичный адрес из сервера бывает недоступен (домен
      // за прокси, раздача Wi-Fi для телефона) — и запрос со ссылками висел до таймаута.
      provide: MINIO_PUBLIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => {
        const publicEndpoint = config.get('MINIO_PUBLIC_ENDPOINT', { infer: true })
        return new MinioClient({
          endPoint: publicEndpoint ?? config.get('MINIO_ENDPOINT', { infer: true }),
          port: publicEndpoint
            ? config.get('MINIO_PUBLIC_PORT', { infer: true })
            : config.get('MINIO_PORT', { infer: true }),
          useSSL: publicEndpoint
            ? config.get('MINIO_PUBLIC_USE_SSL', { infer: true })
            : config.get('MINIO_USE_SSL', { infer: true }),
          accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
          secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
          region: config.get('MINIO_REGION', { infer: true }),
        })
      },
    },
    MinioBucketsService,
  ],
  exports: [MINIO_CLIENT, MINIO_PUBLIC_CLIENT],
})
export class MinioModule {}
