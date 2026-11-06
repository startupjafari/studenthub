import { Controller, Get, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { LibraryDebtsService } from './library-debts.service'

// Книги за студентом при выпуске и отчислении, справка «задолженностей нет» (§3.11).
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryDebtsController {
  constructor(private readonly debts: LibraryDebtsService) {}

  @Get('readers/:id/debts')
  @Roles(Role.DEAN, Role.UNIVERSITY_ADMIN, Role.LIBRARIAN)
  @ApiOperation({ summary: 'Книги на руках у студента — при смене статуса и для библиотекаря' })
  @ApiResponse({ status: 403, description: 'Студент вне области: чужой факультет или вуз' })
  readerDebts(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.debts.debts(user, id)
  }

  @Get('me/clearance')
  @Roles(Role.STUDENT, Role.STAROSTA)
  @ApiOperation({ summary: 'Справка: задолженностей в библиотеке нет (или что вернуть)' })
  clearance(@CurrentUser() user: CurrentUserData) {
    return this.debts.clearance(user)
  }
}
