import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { KatoService } from './kato.service'
import { KatoSearchDto } from './dto/kato-search.dto'
import { KatoResolveDto } from './dto/kato-resolve.dto'

// Справочник КАТО. Без @Roles: названия городов — не персональные данные, и выбор города
// нужен и платформенному админу (реквизиты вуза), и студенту (профиль). Scope-гейта тоже
// нет — справочник общий для платформы и от вуза не зависит.
@ApiTags('Справочник КАТО')
@ApiBearerAuth()
@Controller('kato')
export class KatoController {
  constructor(private readonly kato: KatoService) {}

  @Get()
  @ApiOperation({ summary: 'Поиск по справочнику КАТО (населённые пункты или регионы)' })
  @ApiResponse({ status: 200, description: 'Найденные объекты, не более limit' })
  @ApiResponse({ status: 401, description: 'Не аутентифицирован' })
  @ApiResponse({ status: 422, description: 'Ошибка валидации query-параметров' })
  search(@Query() query: KatoSearchDto) {
    return this.kato.search(query)
  }

  @Get('resolve')
  @ApiOperation({ summary: 'Названия по списку кодов КАТО (до 100 за запрос)' })
  @ApiResponse({ status: 200, description: 'Найденные объекты; неизвестные коды опускаются' })
  @ApiResponse({ status: 401, description: 'Не аутентифицирован' })
  @ApiResponse({ status: 422, description: 'Некорректный код или их больше 100' })
  resolve(@Query() query: KatoResolveDto) {
    return this.kato.resolve(query)
  }
}
