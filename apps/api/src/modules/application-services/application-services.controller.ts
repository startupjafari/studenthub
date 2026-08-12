import { Controller, Get, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { CatalogService } from './catalog.service'

// Каталог услуг университета (доступен всем авторизованным — студент выбирает услугу).
@ApiTags('Услуги университета')
@ApiBearerAuth()
@Controller()
export class ApplicationServicesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('application-categories')
  @ApiOperation({ summary: 'Каталог: категории с доступными услугами (экран выбора услуги)' })
  categories(@CurrentUser() user: CurrentUserData) {
    return this.catalog.listCategories(user)
  }

  @Get('application-services/:id')
  @ApiOperation({ summary: 'Детали услуги: описание, требования-документы, поля формы' })
  service(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.catalog.getService(id, user)
  }
}
