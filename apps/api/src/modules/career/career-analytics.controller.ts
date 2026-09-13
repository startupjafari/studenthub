import { Controller, Get, Query, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { CareerAnalyticsService } from './career-analytics.service'
import { CareerReportService } from './career-report.service'
import { CareerReportQueryDto } from './dto/career-report-query.dto'
import { UniversityScopeDto } from './dto/university-scope.dto'

@ApiTags('Карьера — метрики')
@ApiBearerAuth()
@Controller('career/analytics')
export class CareerAnalyticsController {
  constructor(
    private readonly analytics: CareerAnalyticsService,
    private readonly report: CareerReportService,
    private readonly branding: ExportBrandingService,
  ) {}

  @Get('university')
  @Roles(
    Role.PLATFORM_ADMIN,
    // Модератор платформы — те же разделы карьерного центра, что у модератора вуза,
    // но в любом вузе: вуз выбирается параметром `?universityId` (PROJECT.md §678).
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({ summary: 'Метрики карьерного модуля своего университета (только агрегаты)' })
  @ApiResponse({ status: 200, description: 'Сводка' })
  university(@CurrentUser() user: CurrentUserData, @Query() query: UniversityScopeDto) {
    return this.analytics.forUniversity(user, query.universityId)
  }

  /**
   * Аналитический отчёт за период. Отдельно от сводки обзора: там операционные числа
   * «сейчас», здесь разрезы за период — у них разная цена и разный срок жизни кэша.
   */
  @Get('university/report')
  @Roles(
    Role.PLATFORM_ADMIN,
    // Модератор платформы — те же разделы карьерного центра, что у модератора вуза,
    // но в любом вузе: вуз выбирается параметром `?universityId` (PROJECT.md §678).
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({ summary: 'Отчёт карьерного центра за период (только агрегаты)' })
  @ApiResponse({ status: 200, description: 'Отчёт' })
  universityReport(@CurrentUser() user: CurrentUserData, @Query() query: CareerReportQueryDto) {
    return this.report.forUniversity(user, query.period, query.universityId)
  }

  @Get('university/report/export')
  @Roles(
    Role.PLATFORM_ADMIN,
    // Модератор платформы — те же разделы карьерного центра, что у модератора вуза,
    // но в любом вузе: вуз выбирается параметром `?universityId` (PROJECT.md §678).
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.DEAN,
  )
  @ApiOperation({ summary: 'Выгрузить отчёт карьерного центра (XLSX/CSV)' })
  @ApiResponse({ status: 200, description: 'Файл отчёта' })
  async exportUniversityReport(
    @CurrentUser() user: CurrentUserData,
    @Query() query: CareerReportQueryDto,
    @Query('format') format: string | undefined,
    @Query('locale') locale: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const ext = format === 'csv' ? 'csv' : 'xlsx'
    const { body, filename } = await this.report.exportReport(
      user,
      query.period,
      query.universityId,
      this.branding.resolveLocale(locale),
      ext,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    await reply
      .header('content-type', this.branding.contentType(ext))
      .header('content-disposition', this.branding.disposition(filename))
      .send(body)
  }

  @Get('company')
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Метрики подбора своей компании' })
  @ApiResponse({ status: 200, description: 'Сводка' })
  company(@CurrentUser() user: CurrentUserData) {
    return this.analytics.forCompany(user)
  }
}
