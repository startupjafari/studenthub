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
import { ResumeService } from './resume.service'
import { UpdateResumeDto } from './dto/update-resume.dto'
import type { ResumeLabels } from './resume-pdf'

@ApiTags('Карьера — резюме')
@Controller('career/resume')
export class ResumeController {
  constructor(private readonly resume: ResumeService) {}

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
   */
  @Get('pdf')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Скачать резюме в PDF' })
  @ApiResponse({ status: 200, description: 'PDF-файл' })
  async pdf(
    @CurrentUser() user: CurrentUserData,
    @Query() labels: Partial<ResumeLabels>,
    @Res() reply: FastifyReply,
  ) {
    const buffer = await this.resume.pdf(user, {
      about: labels.about ?? 'About',
      education: labels.education ?? 'Education',
      skills: labels.skills ?? 'Skills',
      languages: labels.languages ?? 'Languages',
      experience: labels.experience ?? 'Experience',
      projects: labels.projects ?? 'Projects',
      certificates: labels.certificates ?? 'Certificates',
      verified: labels.verified ?? 'verified',
      generated: labels.generated ?? 'StudentHub',
    })
    await reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'attachment; filename="resume.pdf"')
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
