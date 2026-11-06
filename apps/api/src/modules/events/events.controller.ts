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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { EventsService } from './events.service'
import { CreateEventDto } from './dto/create-event.dto'
import { UpdateEventDto } from './dto/update-event.dto'
import { EventListQueryDto } from './dto/event-list-query.dto'
import { CreateEventCommentDto } from './dto/create-event-comment.dto'
import { EventCommentReactionDto } from './dto/event-comment-reaction.dto'
import { EventParticipantsQueryDto } from './dto/event-participants-query.dto'
import { EventCommentsQueryDto } from './dto/event-comments-query.dto'

// Создавать события могут все, кроме модераторов (docs/PROJECT.md §2.2).
const AUTHOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
] as const

@ApiTags('События')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'События по видимости (upcoming/past, only mine)' })
  @ApiResponse({ status: 200, description: 'Страница событий' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: EventListQueryDto) {
    return this.events.list(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать событие (аудитория ограничена ролью)' })
  @ApiResponse({ status: 201, description: 'Событие создано' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateEventDto,
    @Req() req: FastifyRequest,
  ) {
    return this.events.create(user, dto, this.ctx(req))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Событие (если видимо)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND / не видимо' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.getById(user, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить событие (организатор или админ scope)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: FastifyRequest,
  ) {
    return this.events.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить событие (организатор или админ scope)' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.events.remove(user, id, this.ctx(req))
  }

  @Get(':id/meeting')
  @ApiOperation({ summary: 'Ссылка на онлайн-встречу (только участникам и организатору)' })
  @ApiResponse({ status: 200, description: 'Ссылка, код доступа и окно подключения' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — нужна регистрация на событие' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — событие не видно или встречи нет' })
  meeting(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.meeting(user, id)
  }

  @Post(':id/register')
  @ApiOperation({ summary: 'Зарегистрироваться на событие' })
  @ApiResponse({ status: 201, description: 'Зарегистрирован' })
  @ApiResponse({ status: 409, description: 'CONFLICT — событие уже завершилось' })
  register(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.register(user, id)
  }

  @Delete(':id/register')
  @ApiOperation({ summary: 'Отменить регистрацию' })
  @ApiResponse({ status: 200, description: 'Регистрация отменена' })
  cancel(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.cancelRegistration(user, id)
  }

  @Get(':id/participants')
  @ApiOperation({
    summary: 'Участники события (организатор/админ); с limit/cursor — страница',
  })
  @ApiResponse({
    status: 200,
    description: 'Без limit/cursor — массив (до 1000); с ними — страница с meta.cursor/hasNext',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  participants(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: EventParticipantsQueryDto,
  ) {
    return this.events.listParticipants(user, id, query)
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'Комментарии к событию (видны всей аудитории); с limit/cursor — страница',
  })
  @ApiResponse({
    status: 200,
    description:
      'Без limit/cursor — последние 100 по порядку написания; с ними — свежие сверху, meta.cursor/hasNext/total',
  })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — событие не видно' })
  comments(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: EventCommentsQueryDto,
  ) {
    return this.events.listComments(user, id, query)
  }

  @Post(':id/comments')
  @ApiOperation({
    summary: 'Прокомментировать событие: текст, вложения (mediaIds из бакета постов), ответ',
  })
  @ApiResponse({ status: 201, description: 'Комментарий создан' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — вложение чужое или уже прикреплено' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — событие или комментарий для ответа' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  addComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CreateEventCommentDto,
  ) {
    return this.events.addComment(user, id, dto)
  }

  @Get(':id/comments/attachments/:fileId/url')
  @ApiOperation({ summary: 'Ссылка на вложение комментария (как у вложения сообщения чата)' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt, ...MediaInfo }' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — событие не видно или вложения нет' })
  commentAttachmentUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.events.commentAttachmentUrl(user, id, fileId)
  }

  @Post(':id/comments/:commentId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Поставить или снять реакцию на комментарий (одна на человека)' })
  @ApiResponse({ status: 200, description: '{ reactions } — реакции комментария целиком' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — эмодзи не из набора реакций' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — событие или комментарий' })
  reactToComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: EventCommentReactionDto,
  ) {
    return this.events.toggleCommentReaction(user, id, commentId, dto.emoji)
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить комментарий (автор, организатор, админ или модератор)' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async removeComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.events.removeComment(user, id, commentId, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
