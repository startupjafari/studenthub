import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { PrismaService } from '../../common/prisma/prisma.service'

const key = (agentId: string): string => `camera-agent:rev:${agentId}`

/**
 * Сигнал «у агента поменялась конфигурация» для длинного опроса (docs/PROJECT.md §3.10).
 *
 * Счётчик в Redis, а не pub/sub: опрос раз в секунду сверяет одно число — это дешевле
 * отдельного подключения-подписчика и работает при нескольких экземплярах API. Сам счётчик
 * — только повод перепроверить: актуальность конфигурации агент сверяет по хэшу её
 * содержимого, поэтому сброс Redis ничего не ломает, лишь откладывает доставку до
 * следующего опроса.
 */
@Injectable()
export class CameraAgentSignal {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async bump(agentId: string): Promise<void> {
    await this.redis.incr(key(agentId))
  }

  /** Всем агентам вуза — при переключении модуля. */
  async bumpUniversity(universityId: string): Promise<void> {
    const agents = await this.prisma.cameraAgent.findMany({
      where: { universityId },
      select: { id: true },
      take: 100,
    })
    await Promise.all(agents.map((a) => this.bump(a.id)))
  }

  async current(agentId: string): Promise<string> {
    return (await this.redis.get(key(agentId))) ?? '0'
  }
}
