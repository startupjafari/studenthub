import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatGifsService } from './chat-gifs.service'
import { ChatSavedGifsService } from './chat-saved-gifs.service'
import {
  ChatGifSearchQueryDto,
  ChatGifTrendingQueryDto,
  ChatSavedGifCreateDto,
} from './dto/chat-rich-message.dto'

const PAGE_DESCRIPTION =
  '{ items: [{ id, title, width, height, previewUrl, previewWidth, previewHeight }], nextOffset }'

const SAVED_DESCRIPTION =
  '{ id, fileId, sourceFileId, fingerprint, mime, animation, width, height, url, poster, ' +
  'placeholder, expiresAt, createdAt }'

// Поиск GIF во внешнем каталоге (GIPHY) через сервер: ключ каталога клиентам не уходит.
// Отправка выбранного — `POST /chats/:id/gif/external`, недавние свои — `GET /chats/gifs/recent`.
// «Мои GIF» (сохранённые) — здесь же; они, как и недавние, работают без GIPHY_API_KEY.
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats/gifs')
export class ChatGifsController {
  constructor(
    private readonly gifs: ChatGifsService,
    private readonly saved: ChatSavedGifsService,
  ) {}

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

  @Get('saved')
  @ApiOperation({ summary: '«Мои GIF»: сохранённые, свежие сверху, не больше 200' })
  @ApiResponse({ status: 200, description: `[${SAVED_DESCRIPTION}]` })
  listSaved(@CurrentUser() user: CurrentUserData) {
    return this.saved.list(user.sub)
  }

  @Post('saved')
  // Нажатие в меню сообщения; чаще — уже не человек.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Сохранить GIF себе (вложение сообщения из чата, где я участник)',
    description:
      'Повтор того же GIF поднимает его наверх; сверх 200 вытесняется самый давний. ' +
      'Своим устройствам — WS gifs:saved-changed.',
  })
  @ApiResponse({ status: 201, description: SAVED_DESCRIPTION })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — файла нет, это не GIF или нет доступа' })
  save(@CurrentUser() user: CurrentUserData, @Body() dto: ChatSavedGifCreateDto) {
    return this.saved.save(user.sub, dto.fileId)
  }

  @Delete('saved/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать GIF из «Моих GIF» (WS gifs:saved-changed)' })
  @ApiResponse({ status: 204, description: 'Убран (или его там не было)' })
  async removeSaved(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.saved.remove(user.sub, id)
  }
}
