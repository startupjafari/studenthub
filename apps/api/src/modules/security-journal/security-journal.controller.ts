import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { SecurityVisitorsService } from './security-visitors.service'
import { SecurityPassesService } from './security-passes.service'
import { CreateVisitorDto } from './dto/create-visitor.dto'
import { VisitorListQueryDto } from './dto/visitor-list-query.dto'
import { PassListQueryDto } from './dto/pass-list-query.dto'

// Журналы поста охраны (docs/PROJECT.md §3.12). Ведёт охрана, читают охрана и админ вуза.
@ApiTags('Пост охраны')
@ApiBearerAuth()
@Controller('security')
@RestrictedAllowed(Role.SECURITY_GUARD)
export class SecurityJournalController {
  constructor(
    private readonly visitors: SecurityVisitorsService,
    private readonly passes: SecurityPassesService,
  ) {}

  @Get('summary')
  @Roles(Role.SECURITY_GUARD, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Сводка поста за сегодня: проходы и посетители' })
  @ApiResponse({ status: 200, description: 'Счётчики за день по часам вуза' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не охрана и не админ вуза' })
  summary(@CurrentUser() user: CurrentUserData) {
    return this.passes.summary(user)
  }

  @Get('passes')
  @Roles(Role.SECURITY_GUARD, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Журнал проходов студентов своего вуза, новые сверху' })
  @ApiResponse({ status: 200, description: 'Страница журнала' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не охрана и не админ вуза' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — неверный фильтр' })
  listPasses(@CurrentUser() user: CurrentUserData, @Query() query: PassListQueryDto) {
    return this.passes.list(user, query)
  }

  @Get('visitors')
  @Roles(Role.SECURITY_GUARD, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Журнал посетителей своего вуза; `status=inside` — кто в здании' })
  @ApiResponse({ status: 200, description: 'Страница журнала' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не охрана и не админ вуза' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — неверный фильтр' })
  listVisitors(@CurrentUser() user: CurrentUserData, @Query() query: VisitorListQueryDto) {
    return this.visitors.list(user, query)
  }

  @Post('visitors')
  @Roles(Role.SECURITY_GUARD)
  @ApiOperation({ summary: 'Записать посетителя на входе' })
  @ApiResponse({ status: 201, description: 'Запись создана, вход — сейчас' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — не охрана' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — поля записи' })
  createVisitor(@CurrentUser() user: CurrentUserData, @Body() body: CreateVisitorDto) {
    return this.visitors.create(user, body)
  }

  @Post('visitors/:id/exit')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SECURITY_GUARD)
  @ApiOperation({ summary: 'Отметить выход посетителя' })
  @ApiResponse({ status: 200, description: 'Выход отмечен' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — нет записи в своём вузе' })
  @ApiResponse({ status: 409, description: 'CONFLICT (`exited`) — выход уже отмечен' })
  exitVisitor(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.visitors.exit(user, id)
  }
}
