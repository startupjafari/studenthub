import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatStickersService } from './chat-stickers.service'

// Каталог стикеров для клиентов: только опубликованные наборы. Отправка стикера —
// `POST /chats/:id/sticker`, управление каталогом — `/admin/sticker-sets`.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/stickers')
export class ChatStickersController {
  constructor(private readonly stickers: ChatStickersService) {}

  @Get('sets')
  @ApiOperation({ summary: 'Опубликованные наборы стикеров со ссылками на картинки' })
  @ApiResponse({
    status: 200,
    description: '[{ id, title, slug, stickers: [{ id, emoji, width, height, url, expiresAt }] }]',
  })
  sets() {
    return this.stickers.listPublished()
  }

  // Лёгкий каталог для панели (Telegram): полоса наборов рисуется сразу, стикеры набора
  // клиент догружает `sets/:setId`, когда набор доезжает до экрана. `GET sets` остаётся для
  // клиентов, которые берут каталог целиком (iOS, Android).
  @Get('sets/summary')
  @ApiOperation({ summary: 'Опубликованные наборы стикеров: обложка и число стикеров' })
  @ApiResponse({
    status: 200,
    description:
      '[{ id, title, slug, count, cover: { id, emoji, width, height, animated, url, expiresAt } | null }]',
  })
  setsSummary() {
    return this.stickers.listPublishedSummary()
  }

  @Get('sets/:setId')
  @ApiOperation({ summary: 'Один опубликованный набор стикеров со ссылками на картинки' })
  @ApiResponse({
    status: 200,
    description:
      '{ id, title, slug, stickers: [{ id, emoji, width, height, animated, url, expiresAt }] }',
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — набора нет или он не опубликован' })
  set(@Param('setId') setId: string) {
    return this.stickers.publishedSet(setId)
  }

  // `favorites` объявлен раньше `:stickerId/…`: статический сегмент не должен читаться как id.
  @Get('favorites')
  @ApiOperation({ summary: 'Мои избранные стикеры: свежие сверху, не больше 30' })
  @ApiResponse({ status: 200, description: '[{ id, emoji, width, height, url, expiresAt }]' })
  favorites(@CurrentUser() user: CurrentUserData) {
    return this.stickers.listFavorites(user.sub)
  }

  @Post('favorites/:stickerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Добавить стикер в избранное (повтор поднимает наверх)' })
  @ApiResponse({ status: 204, description: 'Добавлен; сверх 30 вытесняется самый давний' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет или набор не опубликован' })
  async addFavorite(
    @CurrentUser() user: CurrentUserData,
    @Param('stickerId') stickerId: string,
  ): Promise<void> {
    await this.stickers.addFavorite(user.sub, stickerId)
  }

  @Delete('favorites/:stickerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать стикер из избранного' })
  @ApiResponse({ status: 204, description: 'Убран (или его там не было)' })
  async removeFavorite(
    @CurrentUser() user: CurrentUserData,
    @Param('stickerId') stickerId: string,
  ): Promise<void> {
    await this.stickers.removeFavorite(user.sub, stickerId)
  }

  @Get(':stickerId/url')
  @ApiOperation({ summary: 'Свежая подписанная ссылка на картинку стикера' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt }' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет или набор не опубликован' })
  url(@Param('stickerId') stickerId: string) {
    return this.stickers.stickerUrl(stickerId)
  }
}
