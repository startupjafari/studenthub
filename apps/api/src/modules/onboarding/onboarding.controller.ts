import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { OnboardingService } from './onboarding.service'
import { SkipOnboardingStepDto } from './dto/skip-onboarding-step.dto'

/**
 * Мастер первичной настройки вуза. Всё — про свой вуз и только для его администратора:
 * university берётся из JWT, в теле запроса его нет ни у одного метода.
 */
@ApiTags('Приход вуза — мастер настройки')
@ApiBearerAuth()
@Controller('onboarding')
@Roles(Role.UNIVERSITY_ADMIN)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiOperation({ summary: 'Состояние мастера: шаги, счётчики, чего не хватает для запуска' })
  @ApiResponse({ status: 200, description: 'Состояние мастера' })
  state(@CurrentUser() user: CurrentUserData) {
    return this.onboarding.state(user)
  }

  @Post('confirm-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Шаг «О вузе»: реквизиты проверены' })
  @ApiResponse({ status: 200, description: 'Состояние мастера' })
  confirmProfile(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.onboarding.confirmProfile(user, this.ctx(req))
  }

  @Post('skip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Пропустить необязательный шаг' })
  @ApiResponse({ status: 200, description: 'Состояние мастера' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — этот шаг нельзя пропустить' })
  skip(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SkipOnboardingStepDto,
    @Req() req: FastifyRequest,
  ) {
    return this.onboarding.skip(user, dto, this.ctx(req))
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Свернуть мастер (не то же самое, что пройти)' })
  @ApiResponse({ status: 200, description: 'Состояние мастера' })
  dismiss(@CurrentUser() user: CurrentUserData) {
    return this.onboarding.dismiss(user)
  }

  @Post('launch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Запустить вуз: PENDING → ACTIVE' })
  @ApiResponse({ status: 200, description: 'Вуз запущен' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — не заполнены обязательные шаги' })
  @ApiResponse({ status: 409, description: 'CONFLICT — вуз уже запущен' })
  launch(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    return this.onboarding.launch(user, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
