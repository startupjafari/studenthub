import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators'
import { PlatformService } from './platform.service'

// Состояние платформы читают все, включая неаутентифицированных: страница логина тоже
// обязана показать режим техработ — иначе человек будет биться в форму, которая всё
// равно не пустит. Наружу уходят только объявления, адресованные посетителю; кто и когда
// двигал рычаги, здесь не публикуется.
@ApiTags('Платформа')
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('state')
  @Public()
  @ApiOperation({ summary: 'Режим техработ, баннер, погашенные разделы, объявленный релиз' })
  @ApiResponse({ status: 200, description: 'Действующее состояние платформы' })
  state() {
    return this.platform.publicState()
  }
}
