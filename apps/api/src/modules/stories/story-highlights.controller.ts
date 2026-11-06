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
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AppException } from '../../common/exceptions/app.exception'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'
import { StoryHighlightsService } from './story-highlights.service'
import { AddStoryHighlightItemDto } from './dto/add-story-highlight-item.dto'
import { CreateStoryHighlightDto } from './dto/create-story-highlight.dto'
import { ReorderStoryHighlightsDto } from './dto/reorder-story-highlights.dto'
import { StoryHighlightsQueryDto } from './dto/story-highlights-query.dto'
import { UpdateStoryHighlightDto } from './dto/update-story-highlight.dto'

// Подборки собирают из своих сторис — значит, те же роли, что публикуют сторисы.
const AUTHOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
  Role.EMPLOYER,
] as const

/**
 * «Актуальное» (docs/PROJECT.md §3.4). Отдельный контроллер под тем же префиксом: статичный
 * сегмент `highlights` маршрутизатор Fastify ставит выше параметра `stories/:id`.
 * Флаг FEATURE_STORIES закрывает и подборки: ряд в профиле отвечает пустым.
 */
@ApiTags('Сторисы')
@ApiBearerAuth()
@Controller('stories/highlights')
export class StoryHighlightsController {
  private readonly enabled: boolean

  constructor(
    private readonly highlights: StoryHighlightsService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.enabled = config.get('FEATURE_STORIES', { infer: true })
  }

  @Get()
  @ApiOperation({ summary: 'Подборки «Актуального» в профиле (видимые зрителю)' })
  @ApiResponse({ status: 200, description: 'Подборки с обложкой и числом видимых сторис' })
  async list(@CurrentUser() user: CurrentUserData, @Query() query: StoryHighlightsQueryDto) {
    if (!this.enabled) return []
    return this.highlights.list(user, query.ownerId)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать подборку с первой сторис (медиа копируется)' })
  @ApiResponse({ status: 201, description: 'Подборка создана' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — сторис не своя или истекла' })
  @ApiResponse({ status: 409, description: 'CONFLICT — подборок слишком много' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateStoryHighlightDto,
    @Req() req: FastifyRequest,
  ) {
    this.assertEnabled()
    return this.highlights.create(user, dto, this.ctx(req))
  }

  @Put('order')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Порядок подборок в профиле (полный список своих id)' })
  @ApiResponse({ status: 204, description: 'Порядок сохранён' })
  async reorder(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ReorderStoryHighlightsDto,
  ): Promise<void> {
    this.assertEnabled()
    await this.highlights.reorder(user, dto.ids)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Подборка со сторис, видимыми зрителю' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет, блокировка или ничего не видно' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    this.assertEnabled()
    return this.highlights.get(user, id)
  }

  @Patch(':id')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Переименовать подборку или сменить обложку' })
  @ApiResponse({ status: 200, description: 'Подборка' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateStoryHighlightDto,
  ) {
    this.assertEnabled()
    return this.highlights.update(user, id, dto)
  }

  @Delete(':id')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить подборку вместе с копиями медиа' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    this.assertEnabled()
    await this.highlights.remove(user, id, this.ctx(req))
  }

  @Post(':id/items')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Добавить свою живую сторис в подборку (в конец)' })
  @ApiResponse({ status: 201, description: 'Подборка' })
  @ApiResponse({ status: 409, description: 'CONFLICT — уже в подборке или подборка полна' })
  addItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddStoryHighlightItemDto,
  ) {
    this.assertEnabled()
    return this.highlights.addItem(user, id, dto.storyId)
  }

  @Put(':id/items/order')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Порядок сторис в подборке (полный список id элементов)' })
  @ApiResponse({ status: 204, description: 'Порядок сохранён' })
  async reorderItems(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ReorderStoryHighlightsDto,
  ): Promise<void> {
    this.assertEnabled()
    await this.highlights.reorderItems(user, id, dto.ids)
  }

  @Delete(':id/items/:itemId')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Убрать сторис из подборки (последняя — подборка удаляется)' })
  @ApiResponse({ status: 200, description: '{ deleted } — удалена ли подборка целиком' })
  removeItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    this.assertEnabled()
    return this.highlights.removeItem(user, id, itemId)
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new AppException('NOT_FOUND', 'Сторисы недоступны')
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
