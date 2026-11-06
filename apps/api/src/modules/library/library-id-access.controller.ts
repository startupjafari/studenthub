import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { LibraryIdAccessService } from './library-id-access.service'
import { IdAccessQueryDto } from './dto/id-access-query.dto'

// Удостоверение читателя по открытой выдаче и журнал просмотров (docs/PROJECT.md §3.11).
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryIdAccessController {
  constructor(private readonly idAccess: LibraryIdAccessService) {}

  @Get('loans/:id/reader')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Удостоверение читателя по открытой выдаче (просмотр — в журнал)' })
  @ApiResponse({ status: 403, description: 'Выдача закрыта — карточка недоступна' })
  readerCard(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.idAccess.readerCard(user, id, { ip: req.ip, userAgent: req.headers['user-agent'] })
  }

  @Get('id-access')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Журнал просмотров удостоверений читателей' })
  journal(@CurrentUser() user: CurrentUserData, @Query() query: IdAccessQueryDto) {
    return this.idAccess.journal(user, query)
  }
}
