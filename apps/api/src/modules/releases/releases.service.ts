import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { MarkReleaseSeenInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { UserService } from '../users/users.service'

export interface ReleaseSeen {
  /** Версия последней ноты «Что нового», которую пользователь закрыл кнопкой «Понятно». */
  version: string | null
  seenAt: Date | null
}

export interface ReleaseState extends ReleaseSeen {
  /**
   * Дата регистрации. Нужна клиенту ровно для одного решения: человеку, который завёл
   * аккаунт после выхода релиза, «Что нового» показывать незачем — для него всё новое.
   * Без этой даты первый вход в продукт начинался бы с рассказа об изменениях в продукте,
   * которого он ещё не видел.
   */
  accountCreatedAt: Date | null
}

/**
 * Состояние «Что нового» на стороне сервера.
 *
 * Тексты релизов сюда не приходят и не уходят: они лежат в бандле web (см. комментарий
 * в `prisma/schema/28-releases.prisma`). Здесь — только отметка «до какой версии человек
 * дочитал», чтобы окно не всплывало заново на каждом устройстве.
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
  ) {}

  async state(userId: string): Promise<ReleaseState> {
    const [view, accountCreatedAt] = await Promise.all([
      this.prisma.releaseView.findUnique({
        where: { userId },
        select: { version: true, seenAt: true },
      }),
      this.users.registeredAt(userId),
    ])

    return {
      version: view?.version ?? null,
      seenAt: view?.seenAt ?? null,
      accountCreatedAt,
    }
  }

  /**
   * Записать прочитанную версию. Сравнения «новее/старее» здесь нет намеренно: клиент
   * присылает версию только тогда, когда сам решил её показать, а показывает он лишь то,
   * что новее уже записанного. Вкладка со старой сборкой в этот момент молчит — она
   * видит в ответе `state` более свежую версию, чем знает сама.
   */
  async markSeen(userId: string, { version }: MarkReleaseSeenInput): Promise<ReleaseSeen> {
    try {
      return await this.prisma.releaseView.upsert({
        where: { userId },
        create: { userId, version },
        update: { version, seenAt: new Date() },
        select: { version: true, seenAt: true },
      })
    } catch (e) {
      // Пользователя удалили, пока жил его access-токен: FK не на что повесить.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new AppException('NOT_FOUND', 'Пользователь не найден')
      }
      throw e
    }
  }
}
