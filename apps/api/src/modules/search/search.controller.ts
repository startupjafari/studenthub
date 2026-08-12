import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { SearchService } from './search.service'
import { SearchQueryDto } from './dto/search-query.dto'

@ApiTags('Поиск')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Глобальный поиск по scope (люди, дисциплины, задания, материалы)' })
  find(@CurrentUser() user: CurrentUserData, @Query() query: SearchQueryDto) {
    return this.search.search(user, query.q)
  }
}
