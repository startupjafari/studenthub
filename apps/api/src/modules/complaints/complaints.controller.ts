import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { ComplaintsService } from './complaints.service'
import { CreateComplaintDto } from './dto/create-complaint.dto'
import { ResolveComplaintDto } from './dto/resolve-complaint.dto'
import { ComplaintListQueryDto } from './dto/complaint-list-query.dto'

// Обрабатывают жалобы модераторы/админы (docs/PROJECT.md §2.2).
const MODERATOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
] as const

@ApiTags('Жалобы')
@ApiBearerAuth()
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  @Roles(Role.STUDENT, Role.STAROSTA, Role.TEACHER)
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } }) // §6.3: 10 / час с пользователя
  @ApiOperation({ summary: 'Подать жалобу на пост/комментарий/сообщение/пользователя' })
  @ApiResponse({ status: 201, description: 'Жалоба создана' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — цель не найдена' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateComplaintDto,
    @Req() req: FastifyRequest,
  ) {
    return this.complaints.create(user, dto, this.ctx(req))
  }

  @Get()
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Очередь жалоб (по scope: модератор вуза — только свой вуз)' })
  @ApiResponse({ status: 200, description: 'Страница жалоб' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ComplaintListQueryDto) {
    return this.complaints.list(user, query)
  }

  @Get(':id')
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Жалоба (scope)' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.complaints.getById(user, id)
  }

  @Get(':id/messages')
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Сообщения чата по жалобе (доступ только по жалобе, пишется в аудит)' })
  @ApiResponse({ status: 200, description: 'Сообщения чата' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — жалоба не на сообщение' })
  messages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.complaints.getMessageContext(user, id, this.ctx(req))
  }

  @Patch(':id/resolve')
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Разрешить жалобу: удалить контент / заблокировать / отклонить' })
  @ApiResponse({ status: 200, description: 'Жалоба обработана' })
  @ApiResponse({ status: 409, description: 'CONFLICT — уже обработана' })
  resolve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @Req() req: FastifyRequest,
  ) {
    return this.complaints.resolve(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
