import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CompaniesService } from './companies.service'
import { EmployerSignupDto } from './dto/employer-signup.dto'
import { VerifyCompanyEmailDto } from './dto/verify-company-email.dto'
import { UpdateCompanyDto } from './dto/update-company.dto'
import { RequestCompanyAccessDto } from './dto/request-company-access.dto'

@ApiTags('Карьера — компании')
@Controller('career/companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

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
  @ApiOperation({ summary: 'Вузы, куда можно подать заявку, со статусом своей заявки' })
  @ApiResponse({ status: 200, description: 'Справочник вузов' })
  universities(@CurrentUser() user: CurrentUserData, @Query('search') search?: string) {
    return this.companies.universityDirectory(user, search)
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

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
