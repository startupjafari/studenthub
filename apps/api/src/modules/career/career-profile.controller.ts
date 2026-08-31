import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CareerProfileService } from './career-profile.service'
import { UpdateCareerProfileDto } from './dto/update-career-profile.dto'
import { SetCareerConsentDto } from './dto/set-career-consent.dto'

@ApiTags('Карьера — профиль')
@ApiBearerAuth()
@Controller('career/profile')
export class CareerProfileController {
  constructor(private readonly profiles: CareerProfileService) {}

  @Get()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Свой карьерный профиль с разбором готовности' })
  @ApiResponse({ status: 200, description: 'Профиль' })
  myProfile(@CurrentUser() user: CurrentUserData) {
    return this.profiles.myProfile(user)
  }

  @Patch()
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Изменить карьерный профиль' })
  @ApiResponse({ status: 200, description: 'Профиль обновлён' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateCareerProfileDto,
    @Req() req: FastifyRequest,
  ) {
    return this.profiles.updateMyProfile(user, dto, this.ctx(req))
  }

  @Post('consents')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Выдать или отозвать согласие на показ поля работодателю' })
  @ApiResponse({ status: 201, description: 'Согласие обновлено' })
  setConsent(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SetCareerConsentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.profiles.setConsent(user, dto, this.ctx(req))
  }

  /**
   * Карточка студента для работодателя. Единственный путь, которым компания видит
   * данные студента, — см. CareerProfileService.cardForEmployer.
   */
  @Get('candidates/:id')
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Карточка кандидата (только допущенный вуз и открытый профиль)' })
  @ApiResponse({ status: 200, description: 'Карточка' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — компания не допущена к вузу' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — профиль скрыт или не существует' })
  candidate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.profiles.cardForEmployer(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
