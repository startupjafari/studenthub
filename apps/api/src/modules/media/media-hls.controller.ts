import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { MediaService } from './media.service'

const PLAYLIST_TYPE = 'application/vnd.apple.mpegurl'

// helmet по умолчанию ставит `Cross-Origin-Resource-Policy: same-origin`. Нативный HLS
// (Safari iOS до 17.1, где нет MSE) грузит плейлисты элементом <video> без CORS, а веб
// живёт на другом origin — такой ответ браузер блокирует, и видео не играет. Доступ здесь
// держит токен `?t=`, а не origin, поэтому ресурс открыт для чужого origin явно.
const CORP_HEADER = 'cross-origin-resource-policy'
const CORP_CROSS_ORIGIN = 'cross-origin'

// Плейлисты HLS отдаются по подписанному токену `?t=`, а не по JWT (BACKEND_RULES §6.1,
// список публичных маршрутов): нативный HLS Safari/iOS запрашивает плейлисты и сегменты
// сам и заголовок Authorization к ним не приложит. Токен выдаёт модуль-владелец файла вместе
// с остальным описанием медиа — после своей проверки прав, ровно как presigned-ссылку на
// оригинал; без токена маршруты отвечают 403.
//
// Лимит частоты выше общего: один зритель — запрос сегмента раз в 4 секунды, а за одним
// IP университетской сети смотрят десятки человек.
@ApiTags('Медиа')
@Controller('media')
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
export class MediaHlsController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get(':fileId/hls/master.m3u8')
  @ApiOperation({ summary: 'Мастер-плейлист HLS (по токену из описания медиа)' })
  @ApiResponse({ status: 200, description: 'Список рендишнов, application/vnd.apple.mpegurl' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — токен недействителен или истёк' })
  async master(
    @Param('fileId') fileId: string,
    @Query('t') token: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const body = await this.media.masterPlaylist(fileId, token)
    await reply
      .header('content-type', PLAYLIST_TYPE)
      .header('cache-control', 'private, no-store')
      .header(CORP_HEADER, CORP_CROSS_ORIGIN)
      .send(body)
  }

  @Public()
  @Get(':fileId/hls/:rendition/index.m3u8')
  @ApiOperation({ summary: 'Плейлист рендишна HLS (по play-токену из мастер-плейлиста)' })
  @ApiResponse({ status: 200, description: 'Список сегментов, application/vnd.apple.mpegurl' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — токен недействителен или истёк' })
  async rendition(
    @Param('fileId') fileId: string,
    @Param('rendition') rendition: string,
    @Query('t') token: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const body = await this.media.renditionPlaylist(fileId, rendition, token)
    await reply
      .header('content-type', PLAYLIST_TYPE)
      .header('cache-control', 'private, max-age=300')
      .header(CORP_HEADER, CORP_CROSS_ORIGIN)
      .send(body)
  }

  @Public()
  @Get(':fileId/hls/:rendition/:segment')
  @ApiOperation({ summary: 'Сегмент HLS — редирект на подписанную ссылку хранилища' })
  @ApiResponse({ status: 302, description: 'Location — presigned URL сегмента' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — токен недействителен или истёк' })
  async segment(
    @Param('fileId') fileId: string,
    @Param('rendition') rendition: string,
    @Param('segment') segment: string,
    @Query('t') token: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.media.segmentUrl(fileId, rendition, segment, token)
    // Подпись стабильна в пределах окна, поэтому и редирект можно ненадолго кешировать.
    await reply
      .header('cache-control', 'private, max-age=300')
      .header(CORP_HEADER, CORP_CROSS_ORIGIN)
      .redirect(url, 302)
  }
}
