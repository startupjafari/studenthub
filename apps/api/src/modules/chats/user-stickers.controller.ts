import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { UserStickerUploadFieldsSchema } from '@studenthub/shared-schemas'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { readUploadWithFields } from '../../common/http/read-upload'
import { UserStickersService } from './user-stickers.service'
import {
  StickerSetPreviewQueryDto,
  UserStickerReorderDto,
  UserStickerSetCreateDto,
  UserStickerSetUpdateDto,
} from './dto/user-sticker.dto'

const SET_RESPONSE =
  '{ id, title, slug, removed, createdAt, stickers: [{ id, emoji, width, height, animated, status, url, expiresAt }] }'

// Свои стикеры (docs/PROJECT.md «Свои стикеры»). Любой вошедший пользователь: личные наборы
// (`mine`), наборы в панели (`added`) и превью по ссылке (`preview`). Владение — только из
// JWT. Каталог платформы — соседний ChatStickersController и `/admin/sticker-sets`.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/stickers')
export class UserStickersController {
  constructor(private readonly stickers: UserStickersService) {}

  // ── Мои наборы ──

  @Get('mine')
  @ApiOperation({ summary: 'Мои наборы стикеров: со статусом сборки каждого стикера' })
  @ApiResponse({ status: 200, description: `[${SET_RESPONSE}]` })
  listMine(@CurrentUser() user: CurrentUserData) {
    return this.stickers.listMine(user.sub)
  }

  @Post('mine')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @ApiOperation({ summary: 'Создать свой набор (сразу добавляется в панель)' })
  @ApiResponse({ status: 201, description: SET_RESPONSE })
  @ApiResponse({
    status: 409,
    description: 'STICKER_LIMIT_REACHED — своих наборов 10 или в панели 50 (details[0].field)',
  })
  createMine(@CurrentUser() user: CurrentUserData, @Body() dto: UserStickerSetCreateDto) {
    return this.stickers.createMine(user.sub, dto)
  }

  @Get('mine/:setId')
  @ApiOperation({ summary: 'Свой набор (перечитывать, пока стикеры собираются)' })
  @ApiResponse({ status: 200, description: SET_RESPONSE })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет или он не мой' })
  getMine(@CurrentUser() user: CurrentUserData, @Param('setId') setId: string) {
    return this.stickers.getMine(user.sub, setId)
  }

  @Patch('mine/:setId')
  @ApiOperation({ summary: 'Переименовать свой набор' })
  @ApiResponse({ status: 200, description: SET_RESPONSE })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — набор снят модерацией' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет или он не мой' })
  renameMine(
    @CurrentUser() user: CurrentUserData,
    @Param('setId') setId: string,
    @Body() dto: UserStickerSetUpdateDto,
  ) {
    return this.stickers.renameMine(user.sub, setId, dto)
  }

  @Delete('mine/:setId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить свой набор: пропадает у добавивших, отправленные стикеры остаются',
  })
  @ApiResponse({ status: 204, description: 'Удалён' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет или он не мой' })
  async deleteMine(
    @CurrentUser() user: CurrentUserData,
    @Param('setId') setId: string,
  ): Promise<void> {
    await this.stickers.deleteMine(user.sub, setId)
  }

  // Загрузка — с потолком частоты: анимацию собирает ffmpeg, и поток загрузок от одного
  // человека не должен занимать воркер (BACKEND_RULES: rate-limit на загрузку).
  @Post('mine/:setId/stickers')
  @Throttle({ default: { limit: 30, ttl: 10 * 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PNG, JPEG, WebP, GIF или видео (mp4/webm/mov), ≤ 10 МБ',
        },
        overlay: {
          type: 'string',
          format: 'binary',
          description: 'Прозрачный PNG поверх анимации (надпись)',
        },
        sourceFileId: { type: 'string', description: 'Вместо file: вложение переписки' },
        emoji: { type: 'string', description: 'Один эмодзи — метка стикера' },
        startMs: { type: 'number', description: 'Начало отрезка анимации, мс' },
        durationMs: { type: 'number', description: 'Длина отрезка, 300–3000 мс' },
        cropX: { type: 'number', description: 'Кадрирование анимации: доли кадра 0…1' },
        cropY: { type: 'number' },
        cropW: { type: 'number' },
        cropH: { type: 'number' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Добавить стикер в свой набор: статика → WebP 512 сразу, GIF/видео → анимированный WebP в воркере',
  })
  @ApiResponse({ status: 201, description: SET_RESPONSE })
  @ApiResponse({ status: 409, description: 'STICKER_LIMIT_REACHED — в наборе уже 120 стикеров' })
  @ApiResponse({
    status: 422,
    description: 'STICKER_SOURCE_INVALID — не картинка/GIF/видео, «бомба» или не уложился в 512 КБ',
  })
  async addSticker(
    @CurrentUser() user: CurrentUserData,
    @Param('setId') setId: string,
    @Req() req: FastifyRequest,
  ) {
    const { fields, files } = await readUploadWithFields(req)
    const file = files.find((f) => f.fieldname === 'file')
    const overlay = files.find((f) => f.fieldname === 'overlay')
    if (files.length > 2 || files.some((f) => f !== file && f !== overlay)) {
      throw new AppException('BAD_REQUEST', 'Ожидаются только поля "file" и "overlay"')
    }
    const parsed = UserStickerUploadFieldsSchema.safeParse({
      emoji: fields.emoji || undefined,
      sourceFileId: fields.sourceFileId || undefined,
      startMs: fields.startMs,
      durationMs: fields.durationMs,
      cropX: fields.cropX,
      cropY: fields.cropY,
      cropW: fields.cropW,
      cropH: fields.cropH,
    })
    if (!parsed.success) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Неверные параметры стикера',
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      )
    }
    return this.stickers.addSticker(user.sub, setId, {
      file: file ? { buffer: file.buffer, filename: file.filename } : undefined,
      overlay: overlay?.buffer,
      fields: parsed.data,
    })
  }

  @Put('mine/:setId/order')
  @ApiOperation({ summary: 'Переставить стикеры своего набора (все живые id по разу)' })
  @ApiResponse({ status: 200, description: SET_RESPONSE })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — список не совпадает с набором' })
  reorder(
    @CurrentUser() user: CurrentUserData,
    @Param('setId') setId: string,
    @Body() dto: UserStickerReorderDto,
  ) {
    return this.stickers.reorder(user.sub, setId, dto)
  }

  @Delete('mine/:setId/stickers/:stickerId')
  @ApiOperation({ summary: 'Убрать стикер из своего набора (отправленные остаются видимыми)' })
  @ApiResponse({ status: 200, description: SET_RESPONSE })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет в наборе' })
  deleteSticker(
    @CurrentUser() user: CurrentUserData,
    @Param('setId') setId: string,
    @Param('stickerId') stickerId: string,
  ) {
    return this.stickers.deleteSticker(user.sub, setId, stickerId)
  }

  // ── Наборы в панели ──

  @Get('added')
  @ApiOperation({ summary: 'Личные наборы в моей панели (свои и чужие по ссылке)' })
  @ApiResponse({
    status: 200,
    description:
      '[{ id, title, slug, isMine, stickers: [{ id, emoji, width, height, animated, url, expiresAt }] }]',
  })
  listAdded(@CurrentUser() user: CurrentUserData) {
    return this.stickers.listAdded(user.sub)
  }

  @Post('added/:setId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Добавить личный набор себе в панель' })
  @ApiResponse({ status: 204, description: 'Добавлен (повтор поднимает наверх)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет, удалён или снят' })
  @ApiResponse({ status: 409, description: 'STICKER_LIMIT_REACHED — в панели уже 50 наборов' })
  async addSet(@CurrentUser() user: CurrentUserData, @Param('setId') setId: string) {
    await this.stickers.addSet(user.sub, setId)
  }

  @Delete('added/:setId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать набор из своей панели (свой набор не удаляется)' })
  @ApiResponse({ status: 204, description: 'Убран (или его там не было)' })
  async removeSet(@CurrentUser() user: CurrentUserData, @Param('setId') setId: string) {
    await this.stickers.removeSet(user.sub, setId)
  }

  @Get('preview')
  @ApiOperation({
    summary: 'Превью набора по короткому имени (ссылка /addstickers/<slug>) или по id набора',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ id, title, slug, kind, isMine, isAdded, stickers: [...] } — автор не раскрывается',
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет, удалён или снят' })
  preview(@CurrentUser() user: CurrentUserData, @Query() query: StickerSetPreviewQueryDto) {
    return this.stickers.preview(user.sub, query)
  }
}
