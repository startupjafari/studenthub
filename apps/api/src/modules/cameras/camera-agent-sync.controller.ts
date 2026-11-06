import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../common/decorators/public.decorator'
import { AgentAuthGuard, type AgentPrincipal } from './agent-auth.guard'
import { CurrentAgent } from './current-agent.decorator'
import { CameraAgentSyncService } from './camera-agent-sync.service'
import { CameraAgentSyncDto } from './dto/camera-agent-sync.dto'

// Вход агента камер (docs/PROJECT.md §3.10, BACKEND_RULES §6.1). @Public() снимает только
// JWT: у агента его нет. Вместо него — AgentAuthGuard по токену агента.
@ApiTags('Камеры — агент')
@Controller('camera-agent')
export class CameraAgentSyncController {
  constructor(private readonly sync: CameraAgentSyncService) {}

  @Public()
  @UseGuards(AgentAuthGuard)
  // Агент приходит раз в ≤25 с; запас — на рестарты и повторы после обрыва.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Authorization', description: 'Agent <токен агента>' })
  @ApiOperation({
    summary: 'Длинный опрос агента: отчёт о камерах, ответ — конфигурация (ждёт до 25 с)',
  })
  @ApiResponse({ status: 200, description: '{ revision, enabled, cameras }' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED — токен агента неизвестен' })
  @ApiResponse({
    status: 409,
    description: 'CONFLICT (details.field=publicKey) — ключ агента сменился: перевыпустить токен',
  })
  syncAgent(@CurrentAgent() agent: AgentPrincipal, @Body() dto: CameraAgentSyncDto) {
    return this.sync.sync(agent, dto)
  }
}
