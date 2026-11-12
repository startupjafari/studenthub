import { Controller, Get, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
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

  @Get(':stickerId/url')
  @ApiOperation({ summary: 'Свежая подписанная ссылка на картинку стикера' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt }' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет или набор не опубликован' })
  url(@Param('stickerId') stickerId: string) {
    return this.stickers.stickerUrl(stickerId)
  }
}
