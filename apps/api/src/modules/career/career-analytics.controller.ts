import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { CareerAnalyticsService } from './career-analytics.service'

@ApiTags('Карьера — метрики')
@ApiBearerAuth()
@Controller('career/analytics')
export class CareerAnalyticsController {
  constructor(private readonly analytics: CareerAnalyticsService) {}

  @Get('university')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.DEAN)
  @ApiOperation({ summary: 'Метрики карьерного модуля своего университета (только агрегаты)' })
  @ApiResponse({ status: 200, description: 'Сводка' })
  university(@CurrentUser() user: CurrentUserData) {
    return this.analytics.forUniversity(user)
  }

  @Get('company')
  @Roles(Role.EMPLOYER)
  @ApiOperation({ summary: 'Метрики подбора своей компании' })
  @ApiResponse({ status: 200, description: 'Сводка' })
  company(@CurrentUser() user: CurrentUserData) {
    return this.analytics.forCompany(user)
  }
}
