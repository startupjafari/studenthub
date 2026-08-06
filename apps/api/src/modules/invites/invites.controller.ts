import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { InviteService } from './invites.service'
import { CreateInviteDto } from './dto/create-invite.dto'
import { OffsetPaginationDto } from './dto/offset-pagination.dto'

@ApiTags('Инвайты')
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InviteService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.STAROSTA)
  @ApiOperation({ summary: 'Выдать инвайт (роль строго ниже своей, в своём scope)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateInviteDto,
    @Req() req: FastifyRequest,
  ) {
    return this.invites.create(user, dto, this.ctx(req))
  }

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.STAROSTA)
  @ApiOperation({ summary: 'Мои выданные инвайты' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: OffsetPaginationDto) {
    return this.invites.list(user, query.page, query.limit)
  }

  @Public()
  @Get(':token/preview')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } }) // §6.3: 10 / час с IP
  @ApiOperation({ summary: 'Публичный предпросмотр инвайта по токену' })
  preview(@Param('token') token: string) {
    return this.invites.preview(token)
  }

  @Patch(':id/revoke')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.STAROSTA)
  @ApiOperation({ summary: 'Отозвать ожидающий инвайт' })
  revoke(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.invites.revoke(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
