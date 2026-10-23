import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { DocumentJournalService } from './document-journal.service'
import { DocumentJournalQueryDto } from './dto/document-journal-query.dto'

// Журнал документов вуза для админа вуза (§15.2): метаданные действий, без содержимого.
@ApiTags('Документы')
@ApiBearerAuth()
@Controller('document-journal')
export class DocumentJournalController {
  constructor(private readonly journal: DocumentJournalService) {}

  @Get()
  @Roles(Role.UNIVERSITY_ADMIN)
  @ApiOperation({
    summary:
      'Журнал действий с документами своего вуза: кто, над чьим документом (тип/категория), что, когда, через что',
  })
  @ApiResponse({ status: 200, description: 'Страница журнала; meta.total' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — только администратор вуза' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — неверные фильтры' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: DocumentJournalQueryDto) {
    return this.journal.list(user, query)
  }
}
