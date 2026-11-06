import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthThrottle } from '../../common/guards/user-throttler.guard'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from './companies.service'
import { CompanyMembersService } from './company-members.service'
import { CreateCompanyInviteDto } from './dto/create-company-invite.dto'

const HOUR = 60 * 60_000

/**
 * Команда компании (21.D2). Управляет только OWNER — проверка в сервисе по базе, потому что
 * роли в компании в токене нет. Регистрация по приглашению — `POST /auth/register-by-company-invite`
 * (AuthController): сессию выдаёт модуль входа.
 */
@ApiTags('Карьера — команда компании')
@Controller('career/companies')
export class CompanyMembersController {
  constructor(private readonly members: CompanyMembersService) {}

  @Get('me/members')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Участники и ожидающие приглашения своей компании (владелец)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  list(@CurrentUser() user: CurrentUserData) {
    return this.members.list(user)
  }

  /** Каждый вызов — письмо на чужой адрес: лимит строже общего. */
  @Post('me/invites')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  @ApiOperation({ summary: 'Пригласить коллегу по почте (владелец; роль — RECRUITER)' })
  @ApiResponse({ status: 201, description: '{ id, email, expiresAt } — письмо поставлено' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец или компания не активна' })
  @ApiResponse({ status: 409, description: 'CONFLICT — уже в команде или предел приглашений' })
  invite(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCompanyInviteDto,
    @Req() req: FastifyRequest,
  ) {
    return this.members.invite(user, dto, this.ctx(req))
  }

  @Delete('me/invites/:id')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отозвать ожидающее приглашение (владелец)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет такого ожидающего приглашения' })
  revokeInvite(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.members.revokeInvite(user, id, this.ctx(req))
  }

  @Delete('me/members/:userId')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Исключить участника (владелец; не себя и не последнего владельца)' })
  @ApiResponse({ status: 409, description: 'CONFLICT — себя или последнего владельца' })
  removeMember(
    @CurrentUser() user: CurrentUserData,
    @Param('userId') userId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.members.removeMember(user, userId, this.ctx(req))
  }

  /**
   * Предпросмотр приглашения по ссылке из письма — до регистрации, поэтому публичный.
   * Лимит как у предпросмотра инвайта вуза: 30 / час на токен, потолок 200 / час с адреса.
   */
  @Get('invites/:token/preview')
  @Public()
  @AuthThrottle('invite-param', { limit: 30, ttl: HOUR }, { limit: 200, ttl: HOUR })
  @ApiOperation({ summary: 'Предпросмотр приглашения в компанию по токену (публично)' })
  @ApiResponse({ status: 200, description: '{ companyName, email (маска), expiresAt }' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — ссылка недействительна' })
  @ApiResponse({ status: 410, description: 'INVITE_USED / INVITE_REVOKED / INVITE_EXPIRED' })
  preview(@Param('token') token: string) {
    return this.members.preview(token)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
