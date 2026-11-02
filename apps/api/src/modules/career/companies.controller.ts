import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { readSingleUpload } from '../../common/http/read-upload'
import { Paginated } from '../../common/http/paginated'
import { CompaniesService } from './companies.service'
import { CompanyPageService, type CompanyImageKind } from './company-page.service'
import { EmployerSignupDto } from './dto/employer-signup.dto'
import { VerifyCompanyEmailDto } from './dto/verify-company-email.dto'
import { ResendCompanyVerificationDto } from './dto/resend-company-verification.dto'
import { UpdateCompanyDto } from './dto/update-company.dto'
import { RequestCompanyAccessDto } from './dto/request-company-access.dto'
import { CompanyUniversityDirectoryQueryDto } from './dto/company-university-directory-query.dto'

const IMAGE_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
}

@ApiTags('Карьера — компании')
@Controller('career/companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly page: CompanyPageService,
  ) {}

  /**
   * Регистрация работодателя — публичная, в отличие от всей остальной платформы.
   * Обоснование и границы: см. CompaniesService.signup. Лимит как у входа: это точка
   * входа снаружи, и без него очередь модерации у вузов забивается за вечер.
   */
  @Post('signup')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Зарегистрировать компанию-работодателя (публично)' })
  @ApiResponse({ status: 202, description: 'Письмо с подтверждением отправлено' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  signup(@Body() dto: EmployerSignupDto, @Req() req: FastifyRequest) {
    return this.companies.signup(dto, this.ctx(req))
  }

  @Post('verify-email')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить email компании по ссылке из письма' })
  @ApiResponse({ status: 200, description: 'Email подтверждён' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — ссылка недействительна' })
  verifyEmail(@Body() dto: VerifyCompanyEmailDto, @Req() req: FastifyRequest) {
    return this.companies.verifyEmail(dto.token, this.ctx(req))
  }

  /**
   * Новая ссылка подтверждения взамен истёкшей. Публичный: работодатель с неподтверждённой
   * почтой ещё не прошёл бы дальше главной. Ответ одинаков для любого адреса (см. сервис),
   * лимит строже входа — каждый вызов отправляет письмо.
   */
  @Post('resend-verification')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Отправить письмо с подтверждением email компании ещё раз (публично)' })
  @ApiResponse({ status: 202, description: 'Если компания ждёт подтверждения — письмо ушло' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  resendVerification(@Body() dto: ResendCompanyVerificationDto, @Req() req: FastifyRequest) {
    return this.companies.resendVerification(dto, this.ctx(req))
  }

  @Get('me')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Профиль своей компании' })
  @ApiResponse({ status: 200, description: 'Компания' })
  myCompany(@CurrentUser() user: CurrentUserData) {
    return this.companies.myCompany(user)
  }

  @Patch('me')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Изменить профиль своей компании (только владелец)' })
  @ApiResponse({ status: 200, description: 'Компания обновлена' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  updateMyCompany(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateCompanyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.companies.updateMyCompany(user, dto, this.ctx(req))
  }

  @Post('me/logo')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Загрузить логотип своей компании (изображение ≤ 10 МБ, владелец)' })
  @ApiResponse({ status: 201, description: '{ url } — публичная ссылка на логотип' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  setLogo(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.setImage(user, 'logo', req)
  }

  @Delete('me/logo')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить логотип своей компании (владелец)' })
  @ApiResponse({ status: 204, description: 'Удалён' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  async removeLogo(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    await this.page.removeImage(user, 'logo', this.ctx(req))
  }

  @Post('me/cover')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Загрузить обложку страницы компании (изображение ≤ 10 МБ, владелец)' })
  @ApiResponse({ status: 201, description: '{ url } — публичная ссылка на обложку' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  setCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.setImage(user, 'cover', req)
  }

  @Delete('me/cover')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить обложку страницы компании (владелец)' })
  @ApiResponse({ status: 204, description: 'Удалена' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не владелец' })
  async removeCover(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    await this.page.removeImage(user, 'cover', this.ctx(req))
  }

  @Get('me/access')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Заявки и допуски компании к вузам' })
  @ApiResponse({ status: 200, description: 'Список' })
  myAccess(@CurrentUser() user: CurrentUserData) {
    return this.companies.myAccessList(user)
  }

  @Get('me/universities')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Вузы, куда можно подать заявку, со статусом своей заявки (поиск, фильтр access, сортировка name|city, страницы)',
  })
  @ApiResponse({ status: 200, description: 'Страница справочника вузов; meta.total — всего' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — неверные page/limit/sort/access' })
  async universities(
    @CurrentUser() user: CurrentUserData,
    @Query() query: CompanyUniversityDirectoryQueryDto,
  ) {
    const { items, total } = await this.companies.universityDirectory(user, query)
    return new Paginated(items, { total })
  }

  @Post('me/access')
  @Roles(Role.EMPLOYER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Подать заявку на доступ к студентам университета' })
  @ApiResponse({ status: 201, description: 'Заявка подана' })
  @ApiResponse({ status: 409, description: 'CONFLICT — заявка уже есть или доступ открыт' })
  requestAccess(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RequestCompanyAccessDto,
    @Req() req: FastifyRequest,
  ) {
    return this.companies.requestAccess(user, dto, this.ctx(req))
  }

  /**
   * Страница компании: сотрудникам, платформе и ролям вуза с действующим допуском компании.
   * Объявлена после `me/*`: статические пути Fastify и так ставит выше параметра, но читать
   * контроллер так проще.
   */
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Страница компании (витрина) — по допуску вуза смотрящего' })
  @ApiResponse({ status: 200, description: 'Компания; isMember — смотрящий её сотрудник' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет компании или нет допуска' })
  companyPage(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.page.page(user, id)
  }

  private async setImage(user: CurrentUserData, kind: CompanyImageKind, req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.page.setImage(user, kind, buffer, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
