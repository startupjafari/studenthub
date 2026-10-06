import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator'
import { MaintenanceExempt } from '../../common/decorators'
import { ClientVersionService } from './client-version.service'
import { ClientVersionQueryDto } from './dto/client-version-query.dto'

// Поддерживаемая версия мобильного клиента.
//
// Публичный маршрут намеренно (BACKEND_RULES §6.1): приложение спрашивает это до
// входа — иначе человек со старой сборкой упирался бы в форму входа, которая у него
// не работает, и не узнал бы, что дело в версии. Данных в ответе нет никаких, кроме
// номера версии и ссылки на магазин.
//
// Режим техработ ответ не закрывает: во время остановки платформы узнать про
// обновление нужно тем более.
@ApiTags('Клиент')
@MaintenanceExempt()
@Controller('client-version')
export class ClientVersionController {
  constructor(private readonly clientVersion: ClientVersionService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Минимальная поддерживаемая версия мобильного клиента' })
  @ApiResponse({ status: 200, description: 'Версия и ссылка на магазин' })
  info(@Query() query: ClientVersionQueryDto) {
    return this.clientVersion.info(query.platform)
  }
}
