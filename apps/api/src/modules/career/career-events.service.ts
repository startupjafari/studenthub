import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CareerEventListQueryInput } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Карьерные мероприятия.
 *
 * Своей сущности у них нет: это обычные события вуза с признаком `careerKind`. Регистрация,
 * аудитория и напоминания уже работают в домене «События» — дублировать их ради одного
 * поля было бы вторым календарём, который надо синхронизировать.
 *
 * Сервис только выбирает карьерные события в скоупе пользователя и показывает, записан ли
 * он. Создание и редактирование остаются в модуле событий: там же права организатора.
 */
@Injectable()
export class CareerEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(viewer: JwtPayload, query: CareerEventListQueryInput) {
    const universityId = viewer.universityId
    if (!universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const where: Prisma.EventWhereInput = {
      careerKind: query.kind ?? { not: null },
      universityId,
      ...(query.past ? { startsAt: { lt: new Date() } } : { startsAt: { gte: new Date() } }),
    }

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          careerKind: true,
          title: true,
          description: true,
          location: true,
          isOnline: true,
          startsAt: true,
          endsAt: true,
          organizer: { select: { id: true, firstName: true, lastName: true } },
          // Записан ли текущий пользователь — одним запросом вместо второго round-trip.
          participants: { where: { userId: viewer.sub }, select: { id: true }, take: 1 },
          _count: { select: { participants: true } },
        },
        orderBy: { startsAt: query.past ? 'desc' : 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.event.count({ where }),
    ])

    const rows = items.map(({ participants, _count, ...event }) => ({
      ...event,
      registered: participants.length > 0,
      participantsCount: _count.participants,
    }))
    return new Paginated(rows, { total })
  }
}
