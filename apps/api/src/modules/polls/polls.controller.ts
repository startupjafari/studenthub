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
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { PollsService } from './polls.service'
import { CreatePollDto } from './dto/create-poll.dto'
import { UpdatePollDto } from './dto/update-poll.dto'
import { VotePollDto } from './dto/vote-poll.dto'
import { PollCommentDto } from './dto/poll-comment.dto'

// Опросы профиля: создание, голосование, результаты (docs/PROJECT.md §3.7).
@ApiTags('Опросы')
@ApiBearerAuth()
@Controller('polls')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Post()
  @ApiOperation({ summary: 'Создать опрос' })
  @ApiResponse({ status: 201, description: 'Опрос создан' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreatePollDto) {
    return this.polls.create(user, dto)
  }

  @Get('by-user/:userId')
  @ApiOperation({ summary: 'Опросы пользователя (по видимости смотрящего)' })
  listByUser(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.polls.listByUser(user, userId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Опрос с результатами/состоянием для смотрящего' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.polls.get(user, id)
  }

  @Post(':id/vote')
  @ApiOperation({ summary: 'Проголосовать' })
  vote(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: VotePollDto) {
    return this.polls.vote(user, id, dto)
  }

  @Delete(':id/vote')
  @ApiOperation({ summary: 'Отменить свой голос (если разрешено автором)' })
  cancelVote(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.polls.cancelVote(user, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить свой опрос (до появления голосов)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdatePollDto,
  ) {
    return this.polls.update(user, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить опрос (свой; чужой — модератор scope, роль выше автора)' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.polls.remove(user, id, this.ctx(req))
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Комментарии опроса' })
  listComments(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.polls.listComments(user, id)
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Добавить комментарий к опросу' })
  addComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PollCommentDto,
  ) {
    return this.polls.addComment(user, id, dto)
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить комментарий (автор, владелец опроса или модератор scope)' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async deleteComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.polls.deleteComment(user, id, commentId, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
