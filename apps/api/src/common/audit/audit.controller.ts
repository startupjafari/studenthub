import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../decorators/roles.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'
import { AuditService } from './audit.service'
import { AuditListQueryDto } from './audit-list-query.dto'

// Журнал действий (docs/PROJECT.md §11, §8.3). Scope — в AuditService.
@ApiTags('Аудит')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @ApiOperation({ summary: 'Журнал действий (по scope роли)' })
  @ApiResponse({ status: 200, description: 'Страница записей аудита' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: AuditListQueryDto) {
    return this.audit.list(user, query)
  }
}
