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
  Res,
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
import type { FastifyReply, FastifyRequest } from 'fastify'
import { MessageSendRestSchema } from '@studenthub/shared-schemas'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { readSingleUpload, readUploadWithFields } from '../../common/http/read-upload'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import { ChatsService } from './chats.service'
import { CreateChatDto } from './dto/create-chat.dto'
import {
  ChatAttachmentMultipartStartDto,
  ChatAttachmentMultipartUrlsDto,
  ChatAttachmentPresignDto,
  MessageSendUploadedDto,
} from './dto/chat-attachment.dto'
import { AddChatMemberDto } from './dto/add-chat-member.dto'
import { EditChatDto } from './dto/edit-chat.dto'
import { ChatListQueryDto } from './dto/chat-list-query.dto'
import { ChatMessagesQueryDto } from './dto/chat-messages-query.dto'
import { ChatUpdatesQueryDto } from './dto/chat-updates-query.dto'
import { ChatMediaQueryDto } from './dto/chat-media-query.dto'
import { ChatMediaCalendarQueryDto } from './dto/chat-media-calendar-query.dto'
import { ChatExportFileQueryDto } from './dto/chat-export-file-query.dto'
import { ClearChatDto } from './dto/clear-chat.dto'
import { ChatLinksQueryDto } from './dto/chat-links-query.dto'
import { CreateChatPollDto } from './dto/create-chat-poll.dto'
import { PollVoteDto } from './dto/poll-vote.dto'
import { MuteDto } from './dto/mute.dto'
import { MessageSearchQueryDto } from './dto/message-search-query.dto'
import { MessageReactionDto } from './dto/message-reaction.dto'
import { MessageForwardDto } from './dto/message-forward.dto'
import { SharePostDto } from './dto/share-post.dto'
import { ShareStoryDto } from './dto/share-story.dto'
import { StoryReplyDto } from './dto/story-reply.dto'
import { SaveDraftDto } from './dto/save-draft.dto'
import { JoinChatByInviteDto } from './dto/join-chat-by-invite.dto'
import { MessageForwardBatchDto } from './dto/message-forward-batch.dto'
import { MessageIdsDto } from './dto/message-ids.dto'
import {
  ChatChecklistCreateDto,
  ChatContactDto,
  ChatGifExternalSendDto,
  ChatGifRecentQueryDto,
  ChatGifSendDto,
  ChatLocationDto,
  ChatPollsQueryDto,
  ChatStickerSendDto,
  LiveLocationUpdateDto,
} from './dto/chat-rich-message.dto'
import { ChatStickersService } from './chat-stickers.service'
import { ChatGifsService } from './chat-gifs.service'

// REST для чатов (docs/PROJECT.md §3.6, §8.3): список/создание/история/участники.
// Real-time (сообщения, typing, статусы) — через ChatGateway (WS).
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly branding: ExportBrandingService,
    private readonly stickers: ChatStickersService,
    private readonly gifs: ChatGifsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Мои чаты (последнее сообщение, флаг непрочитанного; cursor-пагинация)',
  })
  @ApiResponse({ status: 200, description: 'Страница чатов' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ChatListQueryDto) {
    return this.chats.listChats(user, query)
  }

  @Post()
  @ApiOperation({ summary: 'Создать личный/групповой чат' })
  @ApiResponse({ status: 201, description: 'Чат создан' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateChatDto) {
    return this.chats.createChat(user, dto)
  }

  @Get('search')
  @ApiOperation({ summary: 'Поиск сообщений (в чате при chatId, иначе по всем моим чатам)' })
  @ApiResponse({ status: 200, description: 'Страница найденных сообщений (свежие первыми)' })
  search(@CurrentUser() user: CurrentUserData, @Query() query: MessageSearchQueryDto) {
    return this.chats.searchMessages(user, query)
  }

  @Get('unread')
  @ApiOperation({ summary: 'Сводка непрочитанного для бейджа навигации: { chats, messages }' })
  @ApiResponse({ status: 200, description: 'Число чатов с непрочитанным и всего сообщений' })
  unread(@CurrentUser() user: CurrentUserData) {
    return this.chats.getUnreadSummary(user)
  }

  @Get('saved')
  @ApiOperation({ summary: 'Личный чат «Сохранённые» (§15): найти или создать' })
  @ApiResponse({ status: 200, description: '{ id } чата «Сохранённые»' })
  saved(@CurrentUser() user: CurrentUserData) {
    return this.chats.getSavedChat(user.sub)
  }

  @Get('attachments/:fileId/url')
  @ApiOperation({ summary: 'Presigned URL к вложению сообщения (по членству в чате)' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt, …MediaInfo } — оригинал и варианты' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник чата' })
  attachmentUrl(@CurrentUser() user: CurrentUserData, @Param('fileId') fileId: string) {
    return this.chats.getAttachmentUrl(user.sub, fileId)
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'История сообщений (cursor, только участник)' })
  @ApiResponse({ status: 200, description: 'Страница сообщений (свежие первыми)' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  messages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatMessagesQueryDto,
  ) {
    return this.chats.getMessages(user, id, query)
  }

  @Get(':id/updates')
  @ApiOperation({
    summary: 'Разница по чату с позиции клиента (догон после обрыва связи, только участник)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Новые сообщения (created), изменённые (mutated), удалённые (deletedIds), актуальный latestSeq. ' +
      'overflow=true — разрыв больше лимита, историю нужно перезапросить целиком',
  })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  updates(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatUpdatesQueryDto,
  ) {
    return this.chats.getUpdates(user, id, query)
  }

  @Get(':id/media')
  @ApiOperation({
    summary:
      'Общие материалы: media|file|voice|voice_note|music|gif (cursor, только участник). ' +
      'voice — всё аудио, voice_note — голосовые, music — аудио кроме голосовых',
  })
  @ApiResponse({ status: 200, description: 'Страница вложений по типу' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  media(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatMediaQueryDto,
  ) {
    return this.chats.listChatMedia(user, id, query)
  }

  @Get(':id/media/calendar')
  @ApiOperation({ summary: 'Снимки по дням для календаря перехода по дате (только участник)' })
  @ApiResponse({ status: 200, description: 'По одной миниатюре на день окна' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  mediaCalendar(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatMediaCalendarQueryDto,
  ) {
    return this.chats.getMediaCalendar(user, id, query)
  }

  @Get(':id/links')
  @ApiOperation({ summary: 'Ссылки чата из сообщений (cursor, только участник)' })
  @ApiResponse({ status: 200, description: 'Страница сообщений со ссылками' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  links(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatLinksQueryDto,
  ) {
    return this.chats.listChatLinks(user, id, query)
  }

  @Post(':id/poll')
  @ApiOperation({ summary: 'Создать опрос в чате (§38, только участник)' })
  @ApiResponse({ status: 201, description: 'Сообщение-опрос создано и разослано' })
  createPoll(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CreateChatPollDto,
  ) {
    return this.chats.createPoll(user.sub, id, dto)
  }

  @Get(':id/polls')
  @ApiOperation({ summary: 'Опросы чата — сообщения с опросом, свежие первыми (cursor)' })
  @ApiResponse({ status: 200, description: 'Страница сообщений (полный DTO сообщения)' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  polls(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatPollsQueryDto,
  ) {
    return this.chats.listPolls(user, id, query)
  }

  @Post('polls/:pollId/close')
  @ApiOperation({ summary: 'Завершить опрос (автор опроса или админ/владелец группы)' })
  @ApiResponse({ status: 201, description: 'Результаты завершённого опроса' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не автор и не админ группы' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — опроса нет или сообщение удалено' })
  closePoll(@CurrentUser() user: CurrentUserData, @Param('pollId') pollId: string) {
    return this.chats.closePoll(user, pollId)
  }

  @Get('polls/:pollId')
  @ApiOperation({ summary: 'Результаты опроса (счётчики + свой голос, только участник)' })
  @ApiResponse({ status: 200, description: 'Результаты опроса' })
  pollResults(@CurrentUser() user: CurrentUserData, @Param('pollId') pollId: string) {
    return this.chats.getPollResults(user, pollId)
  }

  @Post('polls/:pollId/vote')
  @ApiOperation({ summary: 'Проголосовать/переголосовать/снять голос (§39, только участник)' })
  @ApiResponse({ status: 201, description: 'Обновлённые результаты опроса' })
  @ApiResponse({ status: 409, description: 'POLL_CLOSED — опрос завершён' })
  votePoll(
    @CurrentUser() user: CurrentUserData,
    @Param('pollId') pollId: string,
    @Body() dto: PollVoteDto,
  ) {
    return this.chats.votePoll(user, pollId, dto)
  }

  @Post(':id/messages')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        replyToId: { type: 'string' },
        nonce: { type: 'string', description: 'Ключ повтора отправки (≤ 64), 10 минут' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Отправить сообщение с вложениями (multipart, только участник)' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано' })
  async sendWithAttachments(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const { fields, files } = await readUploadWithFields(req)
    const parsed = MessageSendRestSchema.safeParse({
      chatId: id,
      content: fields.content,
      replyToId: fields.replyToId,
      replyQuote: fields.replyQuote,
      spoiler: fields.spoiler,
      spoilerIndexes: fields.spoilerIndexes,
      asFiles: fields.asFiles,
      silent: fields.silent,
      nonce: fields.nonce,
    })
    if (!parsed.success) {
      throw new AppException('BAD_REQUEST', 'Некорректные поля сообщения')
    }
    return this.chats.sendMessageRest(
      user.sub,
      parsed.data,
      files.map(({ buffer, filename }) => ({ buffer, name: filename })),
    )
  }

  // ── Крупные вложения: прямая загрузка в хранилище (Фаза 19.0) ──────────────
  // Файлы больше порога буферной загрузки через multipart-запрос не проходят — тело целиком
  // ложится в память процесса. Такие уходят в хранилище напрямую, а сообщение создаётся по
  // ключам уже загруженных объектов. Членство проверяется на каждом шаге: общий маршрут
  // /files о чатах ничего не знает и пустил бы кого угодно писать в chat-media.

  @Post(':id/attachments/presign')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ссылка для прямой загрузки вложения (только участник)' })
  async presignAttachment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatAttachmentPresignDto,
  ) {
    return this.chats.presignAttachment(user.sub, id, dto.mime)
  }

  @Post(':id/attachments/multipart/start')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Открыть многочастную загрузку вложения (только участник)' })
  async startAttachmentMultipart(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatAttachmentMultipartStartDto,
  ) {
    return this.chats.startAttachmentMultipart(user.sub, id, dto.mime, dto.size)
  }

  @Post(':id/attachments/multipart/urls')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Подписи на диапазон частей вложения (только участник)' })
  async attachmentPartUrls(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatAttachmentMultipartUrlsDto,
  ) {
    return this.chats.attachmentPartUrls(user.sub, id, {
      key: dto.key,
      uploadId: dto.uploadId,
      from: dto.from,
      to: dto.to,
    })
  }

  @Post(':id/messages/uploaded')
  @ApiOperation({ summary: 'Сообщение по уже загруженным вложениям (только участник)' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  async sendUploaded(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MessageSendUploadedDto,
  ) {
    return this.chats.sendMessageFromUploads(user.sub, id, dto)
  }

  @Post(':id/messages/hide')
  @ApiOperation({ summary: '«Удалить у себя»: скрыть сообщения только для себя (≤ 100)' })
  @ApiResponse({ status: 201, description: '{ hiddenIds } — скрытые; чужие чату id пропущены' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  hideMessages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MessageIdsDto,
  ) {
    return this.chats.hideMessages(user.sub, id, dto.messageIds)
  }

  @Post(':id/messages/delete')
  @ApiOperation({ summary: '«Удалить у всех» пачкой — только свои сообщения (≤ 100)' })
  @ApiResponse({ status: 201, description: '{ deletedIds, skippedIds }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  deleteMessages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MessageIdsDto,
  ) {
    return this.chats.deleteMessages(user.sub, id, dto.messageIds)
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Удалить своё сообщение у всех (как WS message:delete)' })
  @ApiResponse({ status: 200, description: '{ chatId, messageId }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — чужое сообщение или не участник' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — сообщения нет или уже удалено' })
  deleteMessage(@CurrentUser() user: CurrentUserData, @Param('messageId') messageId: string) {
    return this.chats.deleteMessageRest(user.sub, messageId)
  }

  // ── Особые сообщения: геопозиция, контакт, чек-лист, стикер, GIF ───────────

  @Post(':id/location')
  @ApiOperation({
    summary: 'Отправить геопозицию (только участник); с livePeriod — трансляцию на 15 мин/1 ч/8 ч',
  })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  sendLocation(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatLocationDto,
  ) {
    return this.chats.sendLocation(user.sub, id, dto)
  }

  @Post('messages/:messageId/live-location')
  @HttpCode(HttpStatus.OK)
  // Клиент шлёт точку не чаще раза в 3 с; 40/мин — запас на несколько трансляций сразу.
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Новая точка трансляции геопозиции (только отправитель, пока трансляция идёт; чаще раза в 3 с — без изменений)',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ lat, lng, title, address, liveUntil, liveUpdatedAt, heading, accuracy } — location:updated в чат',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — трансляция не моя; WRONG_SCOPE — не участник',
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND — нет сообщения-трансляции или я не участник',
  })
  @ApiResponse({ status: 409, description: 'LIVE_LOCATION_ENDED — трансляция закончилась' })
  updateLiveLocation(
    @CurrentUser() user: CurrentUserData,
    @Param('messageId') messageId: string,
    @Body() dto: LiveLocationUpdateDto,
  ) {
    return this.chats.updateLiveLocation(user.sub, messageId, dto)
  }

  @Post('messages/:messageId/live-location/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Остановить трансляцию геопозиции (только отправитель)' })
  @ApiResponse({ status: 200, description: 'Геопозиция с liveUntil = сейчас — location:updated' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — трансляция не моя' })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND — нет сообщения-трансляции или я не участник',
  })
  stopLiveLocation(@CurrentUser() user: CurrentUserData, @Param('messageId') messageId: string) {
    return this.chats.stopLiveLocation(user.sub, messageId)
  }

  @Post(':id/contact')
  @ApiOperation({ summary: 'Отправить карточку контакта (хотя бы телефон или почта)' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  sendContact(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatContactDto,
  ) {
    return this.chats.sendContact(user.sub, id, dto)
  }

  @Post(':id/checklist')
  @ApiOperation({ summary: 'Отправить чек-лист (до 50 пунктов)' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  sendChecklist(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatChecklistCreateDto,
  ) {
    return this.chats.sendChecklist(user.sub, id, dto)
  }

  @Post(':id/sticker')
  @ApiOperation({ summary: 'Отправить стикер из опубликованного набора' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — стикера нет или набор не опубликован' })
  sendSticker(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatStickerSendDto,
  ) {
    return this.stickers.send(user.sub, id, dto)
  }

  @Get('gifs/recent')
  @ApiOperation({ summary: 'Недавние GIF, которые я отправлял (свежие первыми, ≤ 50)' })
  @ApiResponse({ status: 200, description: '[{ fileId, width, height, url, expiresAt }]' })
  recentGifs(@CurrentUser() user: CurrentUserData, @Query() query: ChatGifRecentQueryDto) {
    return this.chats.recentGifs(user.sub, query)
  }

  @Post(':id/gif')
  @ApiOperation({ summary: 'Отправить GIF повторно (файл из чата, где я участник)' })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — файла нет, это не GIF или нет доступа' })
  sendGif(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatGifSendDto,
  ) {
    return this.chats.sendGif(user.sub, id, dto)
  }

  @Post(':id/gif/external')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Отправить GIF из каталога (GIPHY) по id — сервер сам скачивает и хранит копию',
  })
  @ApiResponse({ status: 201, description: 'Сообщение создано и разослано (message:new)' })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND — GIF нет в каталоге или нет доступа к чату',
  })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — GIF больше 10 МБ' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED — GIPHY_API_KEY не задан' })
  sendExternalGif(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatGifExternalSendDto,
  ) {
    return this.gifs.sendExternal(user.sub, id, dto)
  }

  @Get(':id/pinned')
  @ApiOperation({ summary: 'Закреплённые сообщения чата (только участник)' })
  @ApiResponse({ status: 200, description: 'Список закреплённых сообщений' })
  pinned(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.listPinned(user.sub, id)
  }

  @Post('messages/:messageId/pin')
  @ApiOperation({ summary: 'Закрепить сообщение (участник чата)' })
  @ApiResponse({ status: 201, description: 'Сообщение закреплено' })
  pin(@CurrentUser() user: CurrentUserData, @Param('messageId') messageId: string) {
    return this.chats.setPinned(user.sub, messageId, true)
  }

  @Delete('messages/:messageId/pin')
  @ApiOperation({ summary: 'Снять закрепление сообщения (участник чата)' })
  @ApiResponse({ status: 200, description: 'Закрепление снято' })
  unpin(@CurrentUser() user: CurrentUserData, @Param('messageId') messageId: string) {
    return this.chats.setPinned(user.sub, messageId, false)
  }

  @Post('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Тоггл эмодзи-реакции на сообщение (участник чата)' })
  @ApiResponse({ status: 201, description: 'Реакция переключена, сообщение обновлено' })
  react(
    @CurrentUser() user: CurrentUserData,
    @Param('messageId') messageId: string,
    @Body() dto: MessageReactionDto,
  ) {
    return this.chats.toggleReaction(user.sub, messageId, dto.emoji)
  }

  @Post('forward')
  // Пачка — до 100 сообщений в 20 чатов за запрос: частоту самих пачек держим отдельно.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Переслать пачку сообщений в несколько чатов (комментарий — перед ними; ' +
      'requestId — ключ идемпотентности на сутки)',
  })
  @ApiResponse({
    status: 201,
    description: '{ results: [{ chatId, ok, messageIds, code? }] } — отказ чата не роняет другие',
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — исходное сообщение не найдено' })
  @ApiResponse({ status: 409, description: 'REQUEST_IN_PROGRESS — тот же requestId ещё идёт' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — антифлуд' })
  forwardBatch(@CurrentUser() user: CurrentUserData, @Body() dto: MessageForwardBatchDto) {
    return this.chats.forwardBatch(user, dto)
  }

  @Post(':id/forward')
  @ApiOperation({ summary: 'Переслать сообщение в этот чат (участник обоих чатов)' })
  @ApiResponse({ status: 201, description: 'Сообщение переслано' })
  forward(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MessageForwardDto,
  ) {
    return this.chats.forwardMessage(user, id, dto.messageId)
  }

  @Post('story-reply')
  @ApiOperation({
    summary:
      'Ответить на сторис: личное сообщение автору с карточкой сторис (чат найдётся или создастся)',
  })
  @ApiResponse({ status: 201, description: '{ chatId, message }' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — своя сторис' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — блокировка или переписка недоступна' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — сторис не видна (истекла, аудитория)' })
  replyToStory(@CurrentUser() user: CurrentUserData, @Body() dto: StoryReplyDto) {
    return this.chats.replyToStory(user, dto.storyId, dto.content)
  }

  @Post(':id/share-story')
  @ApiOperation({ summary: 'Переслать сторис в личный чат (видна и отправителю, и получателю)' })
  @ApiResponse({ status: 201, description: 'Сообщение с карточкой сторис' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — чат не личный' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — получателю сторис недоступна' })
  shareStory(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ShareStoryDto,
  ) {
    return this.chats.shareStory(user, id, dto.storyId, dto.comment)
  }

  @Post(':id/share-post')
  @ApiOperation({ summary: 'Поделиться постом в чат превью-карточкой (участник чата)' })
  @ApiResponse({ status: 201, description: 'Пост отправлен в чат' })
  sharePost(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SharePostDto,
  ) {
    return this.chats.sharePost(user, id, dto.postId, dto.comment)
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Экспорт истории чата (хронологически, только участник)' })
  @ApiResponse({ status: 200, description: 'Массив сообщений для экспорта' })
  exportChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.exportMessages(user.sub, id)
  }

  /**
   * То же самое файлом: с шапкой происхождения, единым именем и заголовками скачивания.
   *
   * Отдельный маршрут, а не `?format=` на эндпоинте выше: тот отдаёт JSON через общий
   * интерцептор ответа, а файл уходит в `reply` мимо него — совмещать оба поведения в
   * одном обработчике значило бы ветвить ответ до интерцептора.
   */
  @Get(':id/export/file')
  @ApiOperation({ summary: 'Скачать историю чата файлом (txt или json)' })
  @ApiResponse({ status: 200, description: 'Файл выгрузки' })
  async exportChatFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: ChatExportFileQueryDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const ext = query.format
    const context = await this.exportContext(user.sub, this.branding.resolveLocale(query.locale))
    const body = await this.chats.exportFile(user.sub, id, {
      context,
      info: this.branding.infoRows(context),
      provenance: this.branding.provenance(context),
      format: ext,
      request: { ip: req.ip, userAgent: req.headers['user-agent'] },
    })
    await reply
      .header('content-type', this.branding.contentType(ext))
      .header(
        'content-disposition',
        this.branding.disposition(this.branding.filename(context, ext)),
      )
      .send(body)
  }

  /** Кто и когда выгружает: ФИО для шапки файла и таймзона вуза для дат. */
  private async exportContext(userId: string, locale: ExportLocale): Promise<ExportContext> {
    const actor = await this.chats.exportActor(userId)
    return {
      kind: 'chat',
      actor: { id: userId, fullName: actor.fullName },
      locale,
      timezone: actor.timezone,
      generatedAt: new Date(),
    }
  }

  @Post(':id/request/accept')
  @ApiOperation({ summary: 'Принять запрос на переписку (§50) — чат становится обычным' })
  @ApiResponse({ status: 201, description: 'Запрос принят' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — решение принимает адресат' })
  acceptRequest(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.acceptChatRequest(user.sub, id)
  }

  @Post(':id/request/decline')
  @ApiOperation({ summary: 'Отклонить запрос на переписку — чат удаляется у обеих сторон' })
  @ApiResponse({ status: 201, description: 'Запрос отклонён' })
  async declineRequest(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<null> {
    await this.chats.declineChatRequest(user.sub, id)
    return null
  }

  @Post(':id/mute')
  @ApiOperation({
    summary:
      'Отключить уведомления чата (§17: minutes? — на время, иначе навсегда; ' +
      'importantOnly? — пропускать ответы мне и упоминания)',
  })
  @ApiResponse({ status: 201, description: 'Уведомления отключены' })
  mute(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: MuteDto) {
    const until = dto.minutes ? new Date(Date.now() + dto.minutes * 60_000) : 'forever'
    return this.chats.setMuted(user.sub, id, until, dto.importantOnly ?? false)
  }

  @Delete(':id/mute')
  @ApiOperation({ summary: 'Включить уведомления чата' })
  @ApiResponse({ status: 200, description: 'Уведомления включены' })
  unmute(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setMuted(user.sub, id, null)
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Убрать чат в архив (у себя)' })
  @ApiResponse({ status: 201, description: 'Чат в архиве' })
  archive(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setChatArchived(user.sub, id, true)
  }

  @Delete(':id/archive')
  @ApiOperation({ summary: 'Вернуть чат из архива' })
  @ApiResponse({ status: 200, description: 'Чат возвращён в список' })
  unarchive(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setChatArchived(user.sub, id, false)
  }

  @Post(':id/pin')
  @ApiOperation({ summary: 'Закрепить чат (у себя, сверху списка)' })
  @ApiResponse({ status: 201, description: 'Чат закреплён' })
  pinChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setChatPinned(user.sub, id, true)
  }

  @Delete(':id/pin')
  @ApiOperation({ summary: 'Открепить чат' })
  @ApiResponse({ status: 200, description: 'Чат откреплён' })
  unpinChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setChatPinned(user.sub, id, false)
  }

  @Get(':id/presence')
  @ApiOperation({ summary: 'Онлайн-статусы участников чата' })
  @ApiResponse({ status: 200, description: 'Список { userId, online }' })
  presence(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.getPresence(user, id)
  }

  @Put(':id/draft')
  @ApiOperation({
    summary: 'Сохранить/очистить черновик сообщения (синхронизация между устройствами)',
  })
  @ApiResponse({ status: 200, description: 'Черновик сохранён' })
  saveDraft(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SaveDraftDto,
  ) {
    return this.chats.saveDraft(user.sub, id, dto.text)
  }

  @Get(':id/reads')
  @ApiOperation({ summary: 'Статусы прочтения участниками (кто прочитал; только участник)' })
  @ApiResponse({ status: 200, description: 'Участники с их lastReadAt' })
  reads(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.getReadReceipts(user, id)
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Участники чата (роль + онлайн-статус) для управления группой' })
  @ApiResponse({ status: 200, description: 'Список участников' })
  members(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.listMembers(user, id)
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Присоединиться к группе по ссылке-приглашению (с кодом из ссылки)' })
  @ApiResponse({ status: 201, description: 'Присоединён (идемпотентно)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — заблокирован в чате или работодатель' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — приглашение недействительно' })
  join(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: JoinChatByInviteDto,
  ) {
    return this.chats.joinByInvite(user, id, dto.code)
  }

  @Get(':id/invite')
  @ApiOperation({ summary: 'Код ссылки-приглашения группы (только админ группы)' })
  @ApiResponse({ status: 200, description: '{ code }' })
  inviteCode(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.getInviteCode(user, id)
  }

  @Post(':id/invite/reset')
  @ApiOperation({ summary: 'Сменить код ссылки-приглашения (прежняя ссылка перестаёт работать)' })
  @ApiResponse({ status: 201, description: '{ code }' })
  resetInvite(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.resetInviteCode(user, id)
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Добавить участника (только участник чата)' })
  @ApiResponse({ status: 201, description: 'Участник добавлен' })
  @ApiResponse({ status: 409, description: 'CONFLICT — уже в чате' })
  addMember(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddChatMemberDto,
  ) {
    return this.chats.addMember(user, id, dto.userId)
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать участника из чата' })
  @ApiResponse({ status: 204, description: 'Участник удалён' })
  async removeMember(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.chats.removeMember(user, id, userId)
  }

  @Post(':id/members/:userId/ban')
  @ApiOperation({ summary: 'Забанить участника группы (только создатель)' })
  @ApiResponse({ status: 201, description: 'Участник забанен' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не создатель группы' })
  banMember(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chats.banMember(user, id, userId)
  }

  @Delete(':id/members/:userId/ban')
  @ApiOperation({ summary: 'Снять бан с участника группы (только создатель)' })
  @ApiResponse({ status: 200, description: 'Бан снят' })
  unbanMember(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chats.unbanMember(user, id, userId)
  }

  @Post(':id/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить аватар группы (изображение, ≤ 10 МБ; только создатель)' })
  async setChatAvatar(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)
    return this.chats.setChatAvatar(user, id, buffer)
  }

  @Delete(':id/avatar')
  @ApiOperation({ summary: 'Удалить аватар группы (только создатель)' })
  removeChatAvatar(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.removeChatAvatar(user, id)
  }

  @Post('blocks/:userId')
  @ApiOperation({ summary: 'Заблокировать пользователя (личная блокировка — запрет переписки)' })
  @ApiResponse({ status: 201, description: 'Пользователь заблокирован' })
  blockUser(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.chats.blockUser(user.sub, userId)
  }

  @Delete('blocks/:userId')
  @ApiOperation({ summary: 'Разблокировать пользователя (снять личную блокировку)' })
  @ApiResponse({ status: 200, description: 'Пользователь разблокирован' })
  unblockUser(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.chats.unblockUser(user.sub, userId)
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Список заблокированных мной пользователей' })
  listBlocked(@CurrentUser() user: CurrentUserData) {
    return this.chats.listBlocked(user.sub)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить название и описание группы (админ)' })
  editChat(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: EditChatDto,
  ) {
    return this.chats.editChat(user, id, dto)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Удалить чат / покинуть группу (владелец GROUP удаляет группу целиком)',
  })
  deleteChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.deleteOrLeaveChat(user, id)
  }

  @Post(':id/clear')
  @ApiOperation({ summary: 'Очистить историю чата «для меня» (целиком или за период)' })
  clearChat(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ClearChatDto,
  ) {
    return this.chats.clearChat(user, id, dto)
  }

  @Post(':id/members/:userId/admin')
  @ApiOperation({ summary: 'Назначить участника админом группы (только создатель)' })
  grantAdmin(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chats.setAdmin(user, id, userId, true)
  }

  @Delete(':id/members/:userId/admin')
  @ApiOperation({ summary: 'Снять с участника права админа (только создатель)' })
  revokeAdmin(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chats.setAdmin(user, id, userId, false)
  }

  @Post(':id/transfer/:userId')
  @ApiOperation({ summary: 'Передать владение группой участнику (только создатель)' })
  transferOwnership(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chats.transferOwnership(user, id, userId)
  }
}
