import { Controller, Get, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ChatLinkPreviewService } from './chat-link-preview.service'
import { LinkPreviewQueryDto } from './dto/link-preview-query.dto'

// Превью ссылки черновика: плашка над полем ввода до отправки (Telegram WebPagePreview).
// Отдельный контроллер со статическим префиксом — путь не должен попасть в `chats/:id`.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/link-preview')
export class ChatLinkPreviewController {
  constructor(private readonly previews: ChatLinkPreviewService) {}

  @Get()
  // Каждый запрос мимо кеша — исходящий поход сервера в чужую сеть. Клиент спрашивает с
  // задержкой после набора и только при смене ссылки; 30 в минуту — с запасом на человека
  // и мало для того, кто захотел бы гонять сервер по списку адресов.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Превью ссылки для черновика (заголовок, описание, сайт; картинка не отдаётся). ' +
      'Только http(s), приватные адреса отклоняются, ответ кешируется',
  })
  @ApiResponse({
    status: 200,
    description: '{ preview: { url, title, description, image: null, siteName } | null }',
  })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED — нет токена' })
  @ApiResponse({
    status: 422,
    description: 'VALIDATION_ERROR — не http(s)-ссылка или длиннее 2048',
  })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — больше 30 запросов в минуту' })
  async preview(@Query() query: LinkPreviewQueryDto) {
    return { preview: await this.previews.preview(query.url) }
  }
}
