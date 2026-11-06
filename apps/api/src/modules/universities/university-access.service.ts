import { Injectable } from '@nestjs/common'
import type { UniversityStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'

// Сколько процесс помнит статус вуза. Проверка стоит на каждом запросе (JwtStrategy), а
// статус меняется руками платформы раз в месяцы: читать его из БД каждый раз незачем. На
// инстансе, где статус сменили, новое значение видно сразу (`remember`), на соседних — не
// позже чем через это время.
const STATUS_MEMO_MS = 15_000

export interface UniversityMember {
  role: Role
  universityId: string | null
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

/**
 * Допуск пользователей вуза по статусу вуза.
 *
 * BLOCKED — вуз закрыт платформой: никто из его пользователей не входит, не обновляет
 * сессию, не регистрируется по инвайту и не ходит в API с уже выданным токеном. ACTIVE и
 * PENDING пускают всех. Платформенные роли и аккаунты без вуза статус вуза не касается.
 *
 * Кэш — память процесса, а не Redis: проверка стоит на каждом запросе, и Redis был бы
 * лишним походом по сети, а промах здесь стоит одного чтения строки по первичному ключу
 * раз в 15 секунд на вуз.
 */
@Injectable()
export class UniversityAccessService {
  private readonly memo = new Map<string, { status: UniversityStatus; until: number }>()

  constructor(private readonly prisma: PrismaService) {}

  /** Отказ, если вуз пользователя его не пускает. */
  async assertAllowed(member: UniversityMember): Promise<void> {
    const denial = await this.denial(member)
    if (denial) {
      throw denial
    }
  }

  /** Почему вуз не пускает пользователя, или null — пускает. */
  async denial(member: UniversityMember): Promise<AppException | null> {
    if (!member.universityId || isPlatform(member.role)) {
      return null
    }
    const status = await this.statusOf(member.universityId)
    if (status === 'BLOCKED') {
      return new AppException(
        'UNIVERSITY_BLOCKED',
        'Университет заблокирован на платформе. Обратитесь в администрацию вуза',
      )
    }
    return null
  }

  /** Статус только что сменили на этом инстансе — запомнить сразу, не дожидаясь срока. */
  remember(universityId: string, status: UniversityStatus): void {
    this.store(universityId, status)
  }

  private async statusOf(universityId: string): Promise<UniversityStatus | null> {
    const hit = this.memo.get(universityId)
    if (hit && hit.until > Date.now()) {
      return hit.status
    }
    const row = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { status: true },
    })
    const status = row?.status ?? null
    this.store(universityId, status)
    return status
  }

  private store(universityId: string, status: UniversityStatus | null): void {
    // Вуза нет — помнить нечего: пользователь с таким universityId существовать не может.
    if (status === null) {
      this.memo.delete(universityId)
      return
    }
    this.memo.set(universityId, { status, until: Date.now() + STATUS_MEMO_MS })
  }
}
