import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import type { RequestContext } from '../auth/auth.service'
import { InviteService } from './invites.service'
import { CreateInviteDto } from './dto/create-invite.dto'
import { BulkInviteCommitDto } from './dto/bulk-invite-commit.dto'
import { InviteListDto } from './dto/invite-list.dto'
import { parseBulkInviteFile } from './bulk-parse'

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
  list(@CurrentUser() user: CurrentUserData, @Query() query: InviteListDto) {
    return this.invites.list(user, query)
  }

  @Post('bulk/preview')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.STAROSTA)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Массовый импорт: разбор CSV/XLSX и валидация без записи' })
  async bulkPreview(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const { buffer, filename } = await this.readBulkFile(req)
    const rows = parseBulkInviteFile(buffer, filename)
    return this.invites.bulkPreview(user, rows)
  }

  @Post('bulk')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.STAROSTA)
  @ApiOperation({ summary: 'Массовый импорт: создать инвайты по подтверждённым строкам' })
  bulkCreate(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: BulkInviteCommitDto,
    @Req() req: FastifyRequest,
  ) {
    return this.invites.bulkCreate(user, dto, this.ctx(req))
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

  // Читает единственный файл импорта + имя (нужно для определения формата CSV/XLSX).
  // readSingleUpload отдаёт только буфер, поэтому читаем part напрямую.
  private async readBulkFile(req: FastifyRequest): Promise<{ buffer: Buffer; filename: string }> {
    const part = await req.file()
    if (!part) {
      throw new AppException('BAD_REQUEST', 'Файл не передан (ожидается multipart-поле "file")')
    }
    try {
      return { buffer: await part.toBuffer(), filename: part.filename }
    } catch {
      throw new AppException('BAD_REQUEST', 'Файл слишком большой для импорта')
    }
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
