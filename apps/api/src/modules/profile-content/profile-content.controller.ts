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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import { ProfileContentService } from './profile-content.service'
import { CreateProfileArticleDto } from './dto/create-profile-article.dto'
import { UpdateProfileArticleDto } from './dto/update-profile-article.dto'
import { PresignProfileMediaDto } from './dto/presign-profile-media.dto'
import { ConfirmProfileMediaDto } from './dto/confirm-profile-media.dto'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { AssignAlbumMediaDto } from './dto/assign-album-media.dto'
import { ContentCommentDto } from './dto/content-comment.dto'

// Контент профиля (вкладки): фото/видео и статьи (опросы — модуль polls).
// Просмотр списков — любой аутентифицированный (как публичный профиль); мутации — только владелец.
@ApiTags('Профиль — контент')
@ApiBearerAuth()
@Controller('profile')
export class ProfileContentController {
  constructor(private readonly content: ProfileContentService) {}

  // ── Медиа (фото/видео) ─────────────────────────────────────────────────────

  @Post('media')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить фото/видео в свой профиль' })
  @ApiResponse({ status: 201, description: 'Медиа загружено' })
  async uploadMedia(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.content.uploadMedia(user, buffer)
  }

  @Post('media/:fileId/poster')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Прикрепить обложку к своему видео (выбранный кадр раскадровки)' })
  async attachPoster(
    @CurrentUser() user: CurrentUserData,
    @Param('fileId') fileId: string,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)
    return this.content.attachPoster(user, fileId, buffer)
  }

  @Post('media/presign')
  @ApiOperation({ summary: 'Presigned URL для прямой загрузки крупного медиа (>10МБ) в MinIO' })
  presignMedia(@CurrentUser() user: CurrentUserData, @Body() dto: PresignProfileMediaDto) {
    return this.content.presignMedia(user, dto)
  }

  @Post('media/confirm')
  @ApiOperation({ summary: 'Подтвердить presigned-загрузку медиа (создаёт запись File)' })
  confirmMedia(@CurrentUser() user: CurrentUserData, @Body() dto: ConfirmProfileMediaDto) {
    return this.content.confirmMedia(user, dto)
  }

  @Get(':userId/media')
  @ApiOperation({ summary: 'Медиа профиля пользователя (фото и видео)' })
  listMedia(@Param('userId') userId: string) {
    return this.content.listMedia(userId)
  }

  @Delete('media/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить своё медиа из профиля' })
  async deleteMedia(
    @CurrentUser() user: CurrentUserData,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    await this.content.deleteMedia(user, fileId)
  }

  // ── Альбомы фото ──────────────────────────────────────────────────────────────

  @Post('albums')
  @ApiOperation({ summary: 'Создать альбом фото' })
  createAlbum(@CurrentUser() user: CurrentUserData, @Body() dto: CreateAlbumDto) {
    return this.content.createAlbum(user, dto)
  }

  @Get(':userId/albums')
  @ApiOperation({ summary: 'Альбомы пользователя (с обложкой и счётчиком)' })
  listAlbums(@Param('userId') userId: string) {
    return this.content.listAlbums(userId)
  }

  @Patch('albums/:id')
  @ApiOperation({ summary: 'Переименовать альбом / выбрать обложку' })
  updateAlbum(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateAlbumDto,
  ) {
    return this.content.updateAlbum(user, id, dto)
  }

  @Delete('albums/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить альбом (фото остаются, без альбома)' })
  async deleteAlbum(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.content.deleteAlbum(user, id)
  }

  @Post('albums/:id/media')
  @ApiOperation({ summary: 'Добавить свои фото в альбом' })
  async assignAlbumMedia(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AssignAlbumMediaDto,
  ): Promise<{ ok: true }> {
    await this.content.assignAlbumMedia(user, id, dto)
    return { ok: true }
  }

  @Delete('albums/:id/media/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать фото из альбома' })
  async removeAlbumMedia(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    await this.content.removeAlbumMedia(user, id, fileId)
  }

  // ── Статьи ──────────────────────────────────────────────────────────────────

  @Post('articles')
  @ApiOperation({ summary: 'Создать статью в своём профиле' })
  @ApiResponse({ status: 201, description: 'Статья создана' })
  createArticle(@CurrentUser() user: CurrentUserData, @Body() dto: CreateProfileArticleDto) {
    return this.content.createArticle(user, dto)
  }

  @Post('articles/cover')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить обложку статьи (изображение) → URL' })
  async uploadArticleCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.content.uploadCover(user, buffer)
  }

  @Get(':userId/articles')
  @ApiOperation({ summary: 'Статьи пользователя (по видимости смотрящего)' })
  listArticles(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.content.listArticles(user, userId)
  }

  @Post('articles/:id/view')
  @ApiOperation({ summary: 'Засчитать просмотр статьи (при открытии читалки)' })
  incrementArticleView(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.content.incrementArticleView(user, id)
  }

  @Get('articles/:id/related')
  @ApiOperation({ summary: 'Похожие статьи автора (по категории/тегам)' })
  relatedArticles(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.content.relatedArticles(user, id)
  }

  @Get('articles/:id/comments')
  @ApiOperation({ summary: 'Комментарии статьи' })
  listArticleComments(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.content.listArticleComments(user, id)
  }

  @Post('articles/:id/comments')
  @ApiOperation({ summary: 'Добавить комментарий к статье' })
  addArticleComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ContentCommentDto,
  ) {
    return this.content.addArticleComment(user, id, dto)
  }

  @Delete('articles/:id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить комментарий (автор или владелец статьи)' })
  async deleteArticleComment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    await this.content.deleteArticleComment(user, id, commentId)
  }

  @Post('articles/:id/bookmark')
  @ApiOperation({ summary: 'Переключить закладку на статью' })
  toggleBookmark(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.content.toggleBookmark(user, id)
  }

  @Get('bookmarks')
  @ApiOperation({ summary: 'Мои закладки (статьи)' })
  listBookmarks(@CurrentUser() user: CurrentUserData) {
    return this.content.listBookmarks(user)
  }

  @Patch('articles/:id')
  @ApiOperation({ summary: 'Изменить свою статью' })
  updateArticle(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateProfileArticleDto,
  ) {
    return this.content.updateArticle(user, id, dto)
  }

  @Delete('articles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить свою статью' })
  async deleteArticle(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<void> {
    await this.content.deleteArticle(user, id)
  }
}
