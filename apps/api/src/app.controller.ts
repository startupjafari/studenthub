import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from './common/decorators'

@ApiTags('Служебное')
@Controller()
export class AppController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Корневой пинг API (демонстрирует конверт success/data)' })
  root(): { name: string; version: string } {
    return { name: 'StudentHub API', version: '1.0.0' }
  }
}
