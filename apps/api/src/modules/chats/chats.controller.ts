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
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { MessageSendRestSchema } from '@studenthub/shared-schemas'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { readSingleUpload, readUploadWithFields } from '../../common/http/read-upload'
import { ChatsService } from './chats.service'
import { CreateChatDto } from './dto/create-chat.dto'
import { AddChatMemberDto } from './dto/add-chat-member.dto'
import { EditChatDto } from './dto/edit-chat.dto'
import { ChatMessagesQueryDto } from './dto/chat-messages-query.dto'
import { MessageSearchQueryDto } from './dto/message-search-query.dto'
import { MessageReactionDto } from './dto/message-reaction.dto'
import { MessageForwardDto } from './dto/message-forward.dto'
import { SharePostDto } from './dto/share-post.dto'

// REST для чатов (docs/PROJECT.md §3.6, §8.3): список/создание/история/участники.
// Real-time (сообщения, typing, статусы) — через ChatGateway (WS).
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  @ApiOperation({ summary: 'Мои чаты (с последним сообщением и флагом непрочитанного)' })
  @ApiResponse({ status: 200, description: 'Список чатов' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.chats.listChats(user)
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

  @Get('attachments/:fileId/url')
  @ApiOperation({ summary: 'Presigned URL к вложению сообщения (по членству в чате)' })
  @ApiResponse({ status: 200, description: 'Временный URL' })
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

  @Post(':id/messages')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        replyToId: { type: 'string' },
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

  @Post(':id/forward')
  @ApiOperation({ summary: 'Переслать сообщение в этот чат (участник обоих чатов)' })
  @ApiResponse({ status: 201, description: 'Сообщение переслано' })
  forward(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MessageForwardDto,
  ) {
    return this.chats.forwardMessage(user.sub, id, dto.messageId)
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

  @Post(':id/mute')
  @ApiOperation({ summary: 'Отключить уведомления чата' })
  @ApiResponse({ status: 201, description: 'Уведомления отключены' })
  mute(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setMuted(user.sub, id, true)
  }

  @Delete(':id/mute')
  @ApiOperation({ summary: 'Включить уведомления чата' })
  @ApiResponse({ status: 200, description: 'Уведомления включены' })
  unmute(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.setMuted(user.sub, id, false)
  }

  @Get(':id/presence')
  @ApiOperation({ summary: 'Онлайн-статусы участников чата' })
  @ApiResponse({ status: 200, description: 'Список { userId, online }' })
  presence(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.getPresence(user.sub, id)
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Участники чата (роль + онлайн-статус) для управления группой' })
  @ApiResponse({ status: 200, description: 'Список участников' })
  members(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.listMembers(user, id)
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Присоединиться к группе по ссылке-приглашению' })
  @ApiResponse({ status: 201, description: 'Присоединён (идемпотентно)' })
  @ApiResponse({
    status: 403,
    description: 'WRONG_SCOPE — чат не является пользовательской группой',
  })
  join(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.joinByInvite(user.sub, id)
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
  @ApiOperation({ summary: 'Изменить название группы (админ)' })
  editTitle(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: EditChatDto,
  ) {
    return this.chats.editChatTitle(user, id, dto.title)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Удалить чат / покинуть группу (владелец GROUP удаляет группу целиком)',
  })
  deleteChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.deleteOrLeaveChat(user, id)
  }

  @Post(':id/clear')
  @ApiOperation({ summary: 'Очистить историю чата «для меня»' })
  clearChat(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.chats.clearChat(user, id)
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
