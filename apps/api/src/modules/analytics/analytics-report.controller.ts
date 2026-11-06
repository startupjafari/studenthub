import { Controller, Get, Query, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AnalyticsReportService } from './analytics-report.service'
import { AnalyticsReportQueryDto } from './dto/analytics-report-query.dto'

@ApiTags('Аналитика')
@ApiBearerAuth()
@Controller('analytics/report')
export class AnalyticsReportController {
  constructor(
    private readonly report: AnalyticsReportService,
    private readonly branding: ExportBrandingService,
  ) {}

  /**
   * Отчёт по сводке файлом. Область — по роли из токена: платформа, свой вуз, факультет,
   * свои курсы преподавателя (AnalyticsReportService.resolveScope).
   */
  @Get('export')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
    Role.TEACHER,
  )
  // Книга собирается синхронно, а расчёт за учебный год читает журнал аудита целиком за
  // период — залп выгрузок держал бы процесс и базу. Пять в минуту хватает человеку.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Выгрузить отчёт по сводке за период (XLSX/CSV)',
    description:
      'Строка на подразделение области (вуз / факультет / группа) и «Итого»: посещаемость, ' +
      'успеваемость, экзамены, заявки, активность. Подразделение меньше 5 студентов ' +
      'выгружается без чисел.',
  })
  @ApiResponse({ status: 200, description: 'Файл отчёта' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — подразделений больше предела' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE — чужой факультет' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — неверный период или формат' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — больше 5 выгрузок в минуту' })
  async export(
    @CurrentUser() user: CurrentUserData,
    @Query() query: AnalyticsReportQueryDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { body, filename } = await this.report.exportReport(
      user,
      { period: query.period, facultyId: query.facultyId, format: query.format },
      this.branding.resolveLocale(query.locale),
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    await reply
      .header('content-type', this.branding.contentType(query.format))
      .header('content-disposition', this.branding.disposition(filename))
      .send(body)
  }
}
