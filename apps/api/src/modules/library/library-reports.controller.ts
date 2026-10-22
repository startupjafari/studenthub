import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { LibraryReportsService } from './library-reports.service'
import { PopularQueryDto } from './dto/popular-query.dto'
import { InventoryScanDto } from './dto/inventory-scan.dto'
import { InventoryQueryDto } from './dto/inventory-query.dto'

// Отчёты библиотеки и инвентаризация (docs/PROJECT.md §3.11).
@ApiTags('Библиотека')
@ApiBearerAuth()
@RestrictedAllowed(Role.LIBRARIAN)
@Controller('library')
export class LibraryReportsController {
  constructor(private readonly reports: LibraryReportsService) {}

  @Get('reports/summary')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Сводка: фонд, выдачи, должники, брони' })
  summary(@CurrentUser() user: CurrentUserData) {
    return this.reports.summary(user)
  }

  @Get('reports/popular')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Самые выдаваемые книги за 30, 90 или 365 дней' })
  popular(@CurrentUser() user: CurrentUserData, @Query() query: PopularQueryDto) {
    return this.reports.popular(user, query.days)
  }

  @Post('inventory/scan')
  @Roles(Role.LIBRARIAN)
  @ApiOperation({ summary: 'Инвентаризация: экземпляр на месте' })
  scan(@CurrentUser() user: CurrentUserData, @Body() dto: InventoryScanDto) {
    return this.reports.scan(user, dto)
  }

  @Get('inventory')
  @Roles(Role.LIBRARIAN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Ход инвентаризации с даты: отмечено и не найдено' })
  inventory(@CurrentUser() user: CurrentUserData, @Query() query: InventoryQueryDto) {
    return this.reports.inventory(user, query)
  }
}
