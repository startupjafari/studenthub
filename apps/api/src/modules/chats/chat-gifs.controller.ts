import { Controller, Get, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ChatGifsService } from './chat-gifs.service'
import { ChatGifSearchQueryDto, ChatGifTrendingQueryDto } from './dto/chat-rich-message.dto'

const PAGE_DESCRIPTION =
  '{ items: [{ id, title, width, height, previewUrl, previewWidth, previewHeight }], nextOffset }'

// Поиск GIF во внешнем каталоге (GIPHY) через сервер: ключ каталога клиентам не уходит.
// Отправка выбранного — `POST /chats/:id/gif/external`, недавние свои — `GET /chats/gifs/recent`.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/gifs')
export class ChatGifsController {
  constructor(private readonly gifs: ChatGifsService) {}

  @Get('trending')
  // Запрос на каждую прокрутку сетки; выше — уже не человек.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Популярные GIF каталога (offset-пагинация, ≤ 50 за раз)' })
  @ApiResponse({ status: 200, description: PAGE_DESCRIPTION })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — offset/limit вне диапазона' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED — GIPHY_API_KEY не задан' })
  trending(@Query() query: ChatGifTrendingQueryDto) {
    return this.gifs.trending(query)
  }

  @Get('search')
  // Поиск по мере набора: клиент делает debounce, лимит — страховка от его отсутствия.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Поиск GIF в каталоге (q 1..50, offset-пагинация, ≤ 50 за раз)' })
  @ApiResponse({ status: 200, description: PAGE_DESCRIPTION })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — пустой или длинный запрос' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED — GIPHY_API_KEY не задан' })
  search(@Query() query: ChatGifSearchQueryDto) {
    return this.gifs.search(query)
  }
}
