import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { DemoRequestsService } from './demo-requests.service'
import { SubmitDemoRequestDto } from './dto/submit-demo-request.dto'
import { VerifyDemoRequestEmailDto } from './dto/verify-demo-request-email.dto'
import { DemoRequestListQueryDto } from './dto/demo-request-list-query.dto'
import { ApproveDemoRequestDto } from './dto/approve-demo-request.dto'
import { RejectDemoRequestDto } from './dto/reject-demo-request.dto'

@ApiTags('Приход вуза — заявки на тестирование')
@Controller('demo-requests')
export class DemoRequestsController {
  constructor(private readonly requests: DemoRequestsService) {}

  /**
   * Подача заявки — публично. Второй публичный эндпоинт, принимающий данные снаружи,
   * после регистрации работодателя, и в отличие от неё он не создаёт ни аккаунта, ни
   * доступа: только строку в очереди к человеку.
   *
   * Лимит как у входа: форма ведёт к живому модератору, и без ограничения очередь
   * набивается за вечер.
   */
  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Подать заявку вуза на тестирование (публично)' })
  @ApiResponse({ status: 202, description: 'Письмо с подтверждением отправлено' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  submit(@Body() dto: SubmitDemoRequestDto, @Req() req: FastifyRequest) {
    return this.requests.submit(dto, this.ctx(req))
  }

  @Post('verify')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить адрес заявки по ссылке из письма' })
  @ApiResponse({ status: 200, description: 'Адрес подтверждён, заявка в очереди' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — ссылка недействительна' })
  verify(@Body() dto: VerifyDemoRequestEmailDto, @Req() req: FastifyRequest) {
    return this.requests.verifyEmail(dto.token, this.ctx(req))
  }

  /**
   * Очередь и решения — только PLATFORM_ADMIN.
   *
   * Модератор платформы сюда не допущен намеренно: это не модерация контента, а решение
   * о допуске организации на платформу, со своим вузом и своими персональными данными
   * в заявке. Такие решения принимает тот, кто за платформу отвечает.
   */
  @Get()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Очередь заявок вузов' })
  @ApiResponse({ status: 200, description: 'Список заявок' })
  list(@Query() query: DemoRequestListQueryDto) {
    return this.requests.list(query)
  }

  @Get(':id')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Заявка целиком' })
  @ApiResponse({ status: 200, description: 'Заявка' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  getById(@Param('id') id: string) {
    return this.requests.getById(id)
  }

  @Post(':id/approve')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Одобрить: завести вуз и выслать приглашение админу вуза' })
  @ApiResponse({ status: 200, description: 'Вуз заведён, приглашение отправлено' })
  @ApiResponse({ status: 409, description: 'CONFLICT — решение уже принято' })
  approve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ApproveDemoRequestDto,
    @Req() req: FastifyRequest,
  ) {
    return this.requests.approve(user, id, dto, this.ctx(req))
  }

  @Post(':id/reject')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отклонить заявку с причиной из списка' })
  @ApiResponse({ status: 200, description: 'Заявка отклонена, письмо отправлено' })
  @ApiResponse({ status: 409, description: 'CONFLICT — решение уже принято' })
  reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RejectDemoRequestDto,
    @Req() req: FastifyRequest,
  ) {
    return this.requests.reject(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
