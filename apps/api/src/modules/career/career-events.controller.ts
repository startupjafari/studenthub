import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { CareerEventsService } from './career-events.service'
import { CareerEventListQueryDto } from './dto/career-event-list-query.dto'

@ApiTags('Карьера — мероприятия')
@ApiBearerAuth()
@Controller('career/events')
export class CareerEventsController {
  constructor(private readonly events: CareerEventsService) {}

  @Get()
  @Roles(
    Role.STUDENT,
    Role.STAROSTA,
    Role.TEACHER,
    Role.DEAN,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
    Role.PLATFORM_ADMIN,
  )
  @ApiOperation({ summary: 'Карьерные мероприятия своего университета' })
  @ApiResponse({ status: 200, description: 'Страница мероприятий' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: CareerEventListQueryDto) {
    return this.events.list(user, query)
  }
}
