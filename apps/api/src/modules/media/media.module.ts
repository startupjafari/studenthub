import { type DynamicModule, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MediaHlsController } from './media-hls.controller'
import { MediaImageProcessor } from './media-image.processor'
import { MediaProcessingService } from './media-processing.service'
import { MediaService } from './media.service'
import { MediaVideoProcessor } from './media-video.processor'

export interface MediaModuleOptions {
  /** Маршруты плейлистов HLS — только в процессе API. */
  http: boolean
  /** Обработчики очередей media-image/media-video: воркер или inline-режим API. */
  processors: boolean
}

/**
 * Единая медиа-система (docs/PROJECT.md «Медиа»).
 *
 * Глобальный: `MediaService` нужен FileService и всем модулям, отдающим медиа (чат, лента,
 * сторисы, профиль, материалы), а обратной зависимости у него нет — модулю не приходится
 * помнить про импорт, чтобы его файлы получили варианты.
 *
 * Один модуль на оба процесса: API регистрирует его с маршрутами, воркер — с процессорами.
 * PrismaModule, MinioModule и QueueModule глобальные.
 */
@Module({})
export class MediaModule {
  static register(options: MediaModuleOptions): DynamicModule {
    return {
      module: MediaModule,
      global: true,
      // Секрет токенов передаётся при каждом sign/verify (MediaService), здесь пусто.
      imports: [JwtModule.register({})],
      controllers: options.http ? [MediaHlsController] : [],
      providers: [
        MediaService,
        ...(options.processors
          ? [MediaProcessingService, MediaImageProcessor, MediaVideoProcessor]
          : []),
      ],
      exports: [MediaService],
    }
  }
}
