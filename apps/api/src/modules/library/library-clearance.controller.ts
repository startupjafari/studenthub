import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import type { RequestContext } from '../auth/auth.service'
import { LibraryClearanceService } from './library-clearance.service'
import { ClearanceListQueryDto } from './dto/clearance-list-query.dto'
import { RevokeClearanceDto } from './dto/revoke-clearance.dto'

// Справка «задолженностей в библиотеке нет» с кодом проверки (Фаза 21.C4, §3.11): студент
// выпускает PDF сам, библиотекарь видит журнал справок вуза и отзывает их. Проверка по коду —
// общая публичная `GET /verify/:code`.
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryClearanceController {
  constructor(
    private readonly clearance: LibraryClearanceService,
    private readonly branding: ExportBrandingService,
  ) {}

  @Post('me/clearance/certificate')
  @Roles(Role.STUDENT, Role.STAROSTA)
  // Каждая справка — запись в бессрочном журнале документов: печатать их пачками незачем.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Справка «задолженностей в библиотеке нет» — PDF с кодом проверки и QR (?locale=ru|kk|en)',
  })
  @ApiResponse({
    status: 201,
    description: 'PDF-файл; код проверки — в заголовке X-Verification-Code',
  })
  @ApiResponse({
    status: 409,
    description:
      'CONFLICT (details.field = debts) — за студентом книги на руках или утерянные с долгом',
  })
  async issueCertificate(
    @CurrentUser() user: CurrentUserData,
    @Query('locale') locale: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, filename, code } = await this.clearance.issueCertificate(
      user,
      this.branding.resolveLocale(locale),
      this.ctx(req),
    )
    await reply
      .status(201)
      .header('content-type', this.branding.contentType('pdf'))
      .header('content-disposition', this.branding.disposition(filename))
      .header('x-verification-code', code)
      .send(buffer)
  }

  @Get('me/clearance/certificates')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Мои справки «задолженностей нет»: коды и статус' })
  myCertificates(@CurrentUser() user: CurrentUserData) {
    return this.clearance.mine(user)
  }

  @Get('clearances')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Журнал выданных справок «задолженностей нет» своего вуза' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ClearanceListQueryDto) {
    return this.clearance.list(user, query)
  }

  @Post('clearances/:code/revoke')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Отозвать справку: проверка по коду покажет «отозван»' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — справки нет или она чужого вуза' })
  @ApiResponse({ status: 409, description: 'CONFLICT (alreadyRevoked) — уже отозвана' })
  revoke(
    @CurrentUser() user: CurrentUserData,
    @Param('code') code: string,
    @Body() dto: RevokeClearanceDto,
    @Req() req: FastifyRequest,
  ) {
    return this.clearance.revoke(user, code, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
