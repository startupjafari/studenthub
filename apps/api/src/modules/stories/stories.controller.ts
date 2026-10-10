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
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { StoriesService } from './stories.service'
import { CreateStoryDto } from './dto/create-story.dto'
import { StoriesFeedQueryDto } from './dto/stories-feed-query.dto'
import { StoryReactionDto } from './dto/story-reaction.dto'
import { StoryViewersQueryDto } from './dto/story-viewers-query.dto'
import { StoryVoteDto } from './dto/story-vote.dto'

// Кто публикует сторисы (docs/PROJECT.md §2.2, строка «Сторисы — создание»):
// те же роли, что и посты, — модераторы контент не создают, работодатель тоже.
const AUTHOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
] as const

@ApiTags('Сторисы')
@ApiBearerAuth()
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Живые сторисы по видимости, сгруппированные в кольца авторов' })
  @ApiResponse({ status: 200, description: 'Кольца авторов' })
  feed(@CurrentUser() user: CurrentUserData, @Query() query: StoriesFeedQueryDto) {
    return this.stories.feed(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Опубликовать сторис на 24 часа (аудитория ограничена ролью)' })
  @ApiResponse({ status: 201, description: 'Сторис создана' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateStoryDto,
    @Req() req: FastifyRequest,
  ) {
    return this.stories.create(user, dto, this.ctx(req))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Сторис по id (если видима и не истекла)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — не видима, истекла или удалена' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.stories.getById(user, id)
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отметить сторис просмотренной (идемпотентно)' })
  @ApiResponse({ status: 204, description: 'Отмечено' })
  async markViewed(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.stories.markViewed(user, id)
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Кто смотрел сторис (только автору, cursor-пагинация)' })
  @ApiResponse({ status: 200, description: 'Страница зрителей' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не автор' })
  viewers(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: StoryViewersQueryDto,
  ) {
    return this.stories.viewers(user, id, query)
  }

  @Post(':id/reactions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Поставить реакцию на сторис (идемпотентно)' })
  @ApiResponse({ status: 204, description: 'Реакция поставлена' })
  async addReaction(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: StoryReactionDto,
  ): Promise<void> {
    await this.stories.addReaction(user, id, dto)
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
    await this.stories.removeReaction(user, id, decodeURIComponent(emoji))
  }

  @Post(':id/vote')
  @ApiOperation({ summary: 'Проголосовать в опросе сторис (повторный голос заменяет прежний)' })
  @ApiResponse({ status: 201, description: 'Сторис с обновлённым опросом' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — опроса нет или чужой вариант' })
  vote(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Body() dto: StoryVoteDto) {
    return this.stories.vote(user, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить сторис (автор или модератор scope)' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE / FORBIDDEN' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.stories.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
