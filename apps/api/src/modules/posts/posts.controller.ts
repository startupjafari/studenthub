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
import { PostsService } from './posts.service'
import { CreatePostDto } from './dto/create-post.dto'
import { RepostDto } from './dto/repost.dto'
import { CreateCommentDto } from './dto/create-comment.dto'
import { ReactionDto } from './dto/reaction.dto'
import { PinPostDto } from './dto/pin-post.dto'
import { UpdatePostDto } from './dto/update-post.dto'
import { FeedQueryDto } from './dto/feed-query.dto'

// Роли, которым разрешено публиковать (docs/PROJECT.md §2.2 — модераторы посты не создают).
const AUTHOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
] as const

@ApiTags('Посты')
@ApiBearerAuth()
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'Лента постов по видимости (cursor-пагинация)' })
  @ApiResponse({ status: 200, description: 'Страница ленты' })
  feed(@CurrentUser() user: CurrentUserData, @Query() query: FeedQueryDto) {
    return this.posts.feed(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать пост (аудитория ограничена ролью)' })
  @ApiResponse({ status: 201, description: 'Пост создан' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreatePostDto,
    @Req() req: FastifyRequest,
  ) {
    return this.posts.create(user, dto, this.ctx(req))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Пост по id (если видим)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND / не видим' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.posts.getById(user, id)
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Засчитать просмотр поста (при открытии в лайтбоксе)' })
  @ApiResponse({ status: 201, description: 'Обновлённое число просмотров' })
  incrementView(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.posts.incrementView(user, id)
  }

  @Get(':id/media/:fileId/url')
  @ApiOperation({ summary: 'Presigned URL к медиа поста (по видимости поста)' })
  @ApiResponse({ status: 200, description: 'Временный URL' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — пост не видим или медиа не найдено' })
  async mediaUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    const url = await this.posts.getMediaUrl(user, id, fileId)
    return { url }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить свою публикацию (заголовок и текст)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / не автор' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @Req() req: FastifyRequest,
  ) {
    return this.posts.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить пост (автор или модератор scope)' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE / FORBIDDEN' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.posts.remove(user, id, this.ctx(req))
  }

  @Patch(':id/pin')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({ summary: 'Закрепить/открепить пост (только роль выше автора)' })
  @ApiResponse({ status: 200, description: 'Готово' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не выше автора / чужой scope' })
  pin(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PinPostDto,
    @Req() req: FastifyRequest,
  ) {
    return this.posts.setPinned(user, id, dto.pinned, this.ctx(req))
  }

  @Post(':id/repost')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Репост (ссылка на оригинал)' })
  @ApiResponse({ status: 201, description: 'Репост создан' })
  @ApiResponse({ status: 400, description: 'Оригинал не опубликован (черновик или отложенный)' })
  @ApiResponse({ status: 403, description: 'Личный пост репостить нельзя' })
  repost(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RepostDto,
    @Req() req: FastifyRequest,
  ) {
    return this.posts.repost(user, id, dto, this.ctx(req))
  }

  @Post(':id/reactions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Поставить реакцию (идемпотентно)' })
  @ApiResponse({ status: 204, description: 'Реакция поставлена' })
  async addReaction(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ReactionDto,
  ): Promise<void> {
    await this.posts.addReaction(user, id, dto)
  }

  @Delete(':id/reactions/:emoji')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снять свою реакцию' })
  @ApiResponse({ status: 204, description: 'Реакция снята' })
  async removeReaction(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ): Promise<void> {
    await this.posts.removeReaction(user, id, decodeURIComponent(emoji))
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Комментарии поста (thread)' })
  @ApiResponse({ status: 200, description: 'Список комментариев' })
  comments(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.posts.listComments(user, id)
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Добавить комментарий (или ответ через parentId)' })
  @ApiResponse({ status: 201, description: 'Комментарий добавлен' })
  addComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.posts.addComment(user, id, dto)
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить комментарий (автор или модератор)' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  async removeComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.posts.removeComment(user, id, commentId, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
