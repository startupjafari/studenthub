import { Body, Controller, Get, Param, Patch, Query, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ResumeService } from './resume.service'
import { UpdateResumeDto } from './dto/update-resume.dto'
import type { ResumeLabels } from './resume-pdf'

@ApiTags('Карьера — резюме')
@Controller('career/resume')
export class ResumeController {
  constructor(
    private readonly resume: ResumeService,
    private readonly branding: ExportBrandingService,
  ) {}

  @Get()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Настройки своего резюме' })
  mine(@CurrentUser() user: CurrentUserData) {
    return this.resume.mine(user)
  }

  @Patch()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Заголовок, публичная ссылка, показ контактов' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateResumeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.resume.update(user, dto, this.ctx(req))
  }

  /**
   * PDF своего резюме.
   *
   * Подписи разделов приходят от клиента: язык интерфейса знает фронт, а держать в API
   * третью копию переводов — верный способ развести их с `messages/*.json`.
   *
   * `?locale=` — язык брендирования (шапка, колонтитул, свойства файла): эти строки живут
   * в API и переводятся им же. Параметр необязательный, старые клиенты продолжают
   * получать русский, контракт не сломан.
   */
  @Get('pdf')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Скачать резюме в PDF' })
  @ApiResponse({ status: 200, description: 'PDF-файл' })
  async pdf(
    @CurrentUser() user: CurrentUserData,
    @Query() query: Partial<ResumeLabels> & { locale?: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, filename } = await this.resume.pdf(
      user,
      {
        about: query.about ?? 'About',
        education: query.education ?? 'Education',
        skills: query.skills ?? 'Skills',
        languages: query.languages ?? 'Languages',
        experience: query.experience ?? 'Experience',
        projects: query.projects ?? 'Projects',
        certificates: query.certificates ?? 'Certificates',
        verified: query.verified ?? 'verified',
        generated: query.generated ?? 'StudentHub',
      },
      this.branding.resolveLocale(query.locale),
      this.ctx(req),
    )
    // Заголовки собирает служба брендирования: имя файла по единому шаблону и обе формы
    // `filename` (RFC 5987). Раньше здесь стояла строка `resume.pdf` — кириллица в имени
    // из неё выйти не могла в принципе.
    await reply
      .header('content-type', this.branding.contentType('pdf'))
      .header('content-disposition', this.branding.disposition(filename))
      .send(buffer)
  }

  /**
   * Публичное резюме по ссылке. Единственный публичный эндпоинт с данными студента —
   * отдаёт ровно то, что он сам опубликовал, и контакты только если включил их.
   * Лимит нужен: ссылку можно перебирать.
   */
  @Get('public/:slug')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Публичное резюме по ссылке' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — ссылки нет или она отключена' })
  publicResume(@Param('slug') slug: string) {
    return this.resume.publicBySlug(slug)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
