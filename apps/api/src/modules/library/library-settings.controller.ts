import { Body, Controller, Get, Patch, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibrarySettingsService } from './library-settings.service'
import { UpdateLibrarySettingsDto } from './dto/update-library-settings.dto'

// Выключатель и правила библиотеки вуза (docs/PROJECT.md §3.11). Читают все, кому открыта
// библиотека, — по ним клиент строит экраны; меняет админ вуза.
@ApiTags('Библиотека')
@ApiBearerAuth()
@Controller('library/settings')
export class LibrarySettingsController {
  constructor(private readonly settings: LibrarySettingsService) {}

  @Get()
  @Roles(Role.STUDENT, Role.STAROSTA, Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @RestrictedAllowed(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Включена ли библиотека вуза и правила выдачи' })
  @ApiResponse({ status: 200, description: 'Настройки; модуль по умолчанию выключен' })
  @ApiResponse({ status: 403, description: 'Роли библиотека не положена' })
  get(@CurrentUser() user: CurrentUserData) {
    return this.settings.forActor(user)
  }

  @Patch()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Включить или выключить библиотеку, поменять правила выдачи' })
  @ApiResponse({ status: 200, description: 'Новые настройки' })
  @ApiResponse({ status: 422, description: 'Срок по умолчанию больше максимального' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateLibrarySettingsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.settings.update(user, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
