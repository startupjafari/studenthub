import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { MeService } from './me.service'

// Агрегирующие endpoint'ы главных экранов (BFF). Собирают данные из доменов по scope роли,
// чтобы клиент делал один запрос вместо многих. Доступен любому аутентифицированному —
// scope и роль берутся из JWT (@CurrentUser), сами доменные сервисы фильтруют по правам.
@ApiTags('Мой день (BFF)')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('today')
  @ApiOperation({ summary: 'Операционный экран «Сегодня» / Action Center (по роли)' })
  today(@CurrentUser() user: CurrentUserData) {
    return this.me.today(user)
  }
}
