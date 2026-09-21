import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { MiniAllowed } from '../../common/decorators/mini-allowed.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { SupportService } from './support.service'
import { OpenSupportTicketDto } from './dto/open-support-ticket.dto'
import { SupportReplyDto } from './dto/support-reply.dto'
import { SupportQueueQueryDto } from './dto/support-queue-query.dto'

// Поддержка платформы: личная линия человека к команде платформы.
//
// Обращение открывает любая роль — вопрос к платформе может быть у кого угодно. Очередь и
// закрытие — команда платформы; они же помечены @MiniAllowed(), потому что разбирать
// обращения с телефона и есть смысл мини-аппа.
const STAFF = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR] as const

@ApiTags('Поддержка платформы')
@ApiBearerAuth()
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  // Лимит на открытие: обращение создаёт чат и будит всю команду платформы.
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiOperation({ summary: 'Открыть обращение (или дописать в уже открытое)' })
  @ApiResponse({ status: 201, description: '{ id, created }' })
  open(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: OpenSupportTicketDto,
    @Req() req: FastifyRequest,
  ) {
    return this.support.open(user, dto, this.ctx(req))
  }

  @Get()
  @Roles(...STAFF)
  @MiniAllowed()
  @ApiOperation({ summary: 'Очередь обращений (по умолчанию открытые)' })
  queue(@CurrentUser() user: CurrentUserData, @Query() query: SupportQueueQueryDto) {
    return this.support.queue(user, query)
  }

  @Get(':id')
  @MiniAllowed()
  @ApiOperation({ summary: 'Переписка обращения (команда платформы или автор)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет такого обращения или нет доступа' })
  thread(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.support.thread(user, id)
  }

  @Post(':id/reply')
  @MiniAllowed()
  @ApiOperation({ summary: 'Ответить (ответ в закрытое обращение открывает его снова)' })
  reply(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SupportReplyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.support.reply(user, id, dto, this.ctx(req))
  }

  @Patch(':id/assign')
  @Roles(...STAFF)
  @MiniAllowed()
  @ApiOperation({ summary: 'Взять обращение себе (или отдать обратно: ?take=false)' })
  @ApiResponse({ status: 409, description: 'CONFLICT — обращение уже разбирает другой' })
  assign(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query('take') take: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.support.assign(user, id, take !== 'false', this.ctx(req))
  }

  @Post(':id/escalate')
  @Roles(...STAFF)
  @MiniAllowed()
  @ApiOperation({ summary: 'Эскалировать обращение администраторам (мимо дежурства и тишины)' })
  escalate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.support.escalate(user, id, this.ctx(req))
  }

  @Patch(':id/close')
  @Roles(...STAFF)
  @MiniAllowed()
  @ApiOperation({ summary: 'Закрыть обращение (переписка остаётся)' })
  close(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Req() req: FastifyRequest) {
    return this.support.close(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
