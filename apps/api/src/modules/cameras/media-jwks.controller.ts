import { Controller, Get, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { MediaTokenService } from './media-token.service'

// Открытый ключ медиатокенов для ретранслятора камер (docs/PROJECT.md §3.10,
// BACKEND_RULES §6.1). Публичный: в нём только открытая часть ключа, и ретранслятор
// забирает его без входа. Отдаётся как есть, без обёртки { success, data } — так JWKS
// ждёт MediaMTX.
@ApiTags('Камеры — ретранслятор')
@Controller('.well-known')
export class MediaJwksController {
  constructor(private readonly tokens: MediaTokenService) {}

  @Public()
  @Get('media-jwks.json')
  @ApiOperation({ summary: 'JWKS медиатокенов: открытый ключ ES256 для ретранслятора' })
  async jwks(@Res() reply: FastifyReply): Promise<void> {
    await reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=300')
      .send(JSON.stringify(this.tokens.jwks()))
  }
}
