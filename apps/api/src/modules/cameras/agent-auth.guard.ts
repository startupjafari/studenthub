import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { hashAgentToken } from './agent-token'

/** Агент, предъявивший токен. Кладётся в request вместо пользователя. */
export interface AgentPrincipal {
  id: string
  universityId: string
  publicKey: string | null
  /** Хэш предъявленного токена: длинный опрос сверяет его перед ответом (перевыпуск). */
  tokenHash: string
}

const SCHEME = 'Agent '

/**
 * Вход агента камер (docs/PROJECT.md §3.10): `Authorization: Agent <токен>`. Маршрут при
 * этом @Public() — JWT у агента нет, — а этот guard стоит на нём явно. Токен ищется по
 * SHA-256 (уникальный индекс), сам токен в базе не хранится. Неизвестный, отозванный и
 * отсутствующий токен — одинаковый 401.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>
      cameraAgent?: AgentPrincipal
    }>()
    const header = req.headers.authorization
    const token =
      typeof header === 'string' && header.startsWith(SCHEME) ? header.slice(SCHEME.length) : ''
    if (!token) throw new AppException('UNAUTHORIZED', 'Нужен токен агента')
    const agent = await this.prisma.cameraAgent.findUnique({
      where: { tokenHash: hashAgentToken(token) },
      select: { id: true, universityId: true, publicKey: true, tokenHash: true },
    })
    if (!agent) throw new AppException('UNAUTHORIZED', 'Токен агента недействителен')
    req.cameraAgent = agent
    return true
  }
}
