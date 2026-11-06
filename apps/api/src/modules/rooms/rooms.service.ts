import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateRoomInput,
  RoomListQueryInput,
  RoomSortValue,
  SortOrderValue,
  UpdateRoomInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UniversityService } from '../universities/universities.service'

/**
 * Порядок выборки помещений по колонке таблицы.
 *
 * Корпус, этаж и вместимость необязательны, поэтому `nulls: 'last'` — помещения без
 * этих данных всегда в конце, а не всплывают наверх при сортировке по возрастанию.
 * Внутри одинаковых значений — по названию: иначе строки с равным этажом на каждой
 * перезагрузке шли бы в произвольном порядке (у Postgres нет стабильной сортировки).
 * Последний ключ — `id`: названия не уникальны (две «101» в разных корпусах), и без
 * него такие строки на стыке страниц дублировались бы или терялись.
 */
function roomOrderBy(
  sort: RoomSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.RoomOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  const byName: Prisma.RoomOrderByWithRelationInput = { name: 'asc' }
  const byId: Prisma.RoomOrderByWithRelationInput = { id: 'asc' }
  switch (sort) {
    case 'kind':
      return [{ kind: dir }, byName, byId]
    case 'building':
      return [{ building: { sort: dir, nulls: 'last' } }, byName, byId]
    case 'floor':
      return [{ floor: { sort: dir, nulls: 'last' } }, byName, byId]
    case 'capacity':
      return [{ capacity: { sort: dir, nulls: 'last' } }, byName, byId]
    case 'qr':
      return [{ qrCode: { sort: dir, nulls: 'first' } }, byName, byId]
    case 'name':
      return [{ name: dir }, byId]
    default:
      return [byName, byId]
  }
}

const ROOM_SELECT = {
  id: true,
  name: true,
  capacity: true,
  universityId: true,
  // Ф16: назначение помещения и ориентиры — нужны и в админке, и на печатной наклейке.
  kind: true,
  building: true,
  floor: true,
  openHours: true,
  phone: true,
  info: true,
  // Выдан ли QR (сам код и картинку отдаёт RoomQrService).
  qrCode: true,
  qrIssuedAt: true,
  createdAt: true,
} satisfies Prisma.RoomSelect

type RoomDto = Prisma.RoomGetPayload<{ select: typeof ROOM_SELECT }>

// Что не даёт удалить помещение. Ключ уходит клиенту в details.field.
const ROOM_DELETION_BLOCKERS = ['pairs', 'exams', 'changes'] as const
type RoomDeletionBlocker = (typeof ROOM_DELETION_BLOCKERS)[number]

const ROOM_DELETION_LABELS: Record<RoomDeletionBlocker, string> = {
  pairs: 'пары в расписании',
  exams: 'предстоящие экзамены',
  changes: 'замены в расписании',
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class RoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly universities: UniversityService,
  ) {}

  /** Создание помещения (PLATFORM_ADMIN / UNIVERSITY_ADMIN своего вуза). */
  async create(actor: JwtPayload, input: CreateRoomInput, ctx: RequestContext): Promise<RoomDto> {
    // Вуз из JWT, если в теле не указан (§6.1): админ вуза создаёт помещения только у себя,
    // и заставлять фронт знать свой universityId незачем. Платформенный админ указывает явно.
    const universityId = input.universityId ?? actor.universityId
    if (!universityId) {
      throw new AppException('BAD_REQUEST', 'Не указан университет')
    }
    this.assertManageScope(actor, universityId)
    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { id: true },
    })
    if (!university) {
      throw new AppException('NOT_FOUND', 'Университет не найден')
    }
    const room = await this.prisma.room.create({
      data: {
        name: input.name,
        capacity: input.capacity,
        universityId,
        kind: input.kind,
        building: input.building,
        floor: input.floor,
        openHours: input.openHours,
        phone: input.phone,
        info: input.info,
      },
      select: ROOM_SELECT,
    })
    // Счётчик «аудиторий» на дашбордах вуза — из кэша статистики; без сброса он отставал
    // до пяти минут.
    await this.universities.invalidateStats(universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'room_created',
      entity: 'Room',
      entityId: room.id,
      metadata: { universityId },
      ...ctx,
    })
    return room
  }

  /** Список аудиторий по scope смотрящего. `search` — подстрока названия без учёта регистра. */
  async list(viewer: JwtPayload, query: RoomListQueryInput): Promise<Paginated<RoomDto>> {
    const { page, limit, universityId, kind, search } = query
    const where: Prisma.RoomWhereInput = {
      ...this.listWhere(viewer, universityId),
      ...(kind ? { kind } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        orderBy: roomOrderBy(query.sort, query.order),
        skip: (page - 1) * limit,
        take: limit,
        select: ROOM_SELECT,
      }),
      this.prisma.room.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  async getById(viewer: JwtPayload, id: string): Promise<RoomDto> {
    const room = await this.findOrThrow(id)
    this.assertReadScope(viewer, room.universityId)
    return room
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateRoomInput,
    ctx: RequestContext,
  ): Promise<RoomDto> {
    const room = await this.findOrThrow(id)
    this.assertManageScope(actor, room.universityId)
    const updated = await this.prisma.room.update({
      where: { id },
      // `null` — осознанная очистка поля (например, убрали телефон), `undefined` — «не меняем».
      // Поэтому nullable-поля прокидываем как есть, а не через `?? undefined`.
      data: {
        name: input.name,
        capacity: input.capacity,
        kind: input.kind,
        building: input.building,
        floor: input.floor,
        openHours: input.openHours,
        phone: input.phone,
        info: input.info,
      },
      select: ROOM_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'room_updated',
      entity: 'Room',
      entityId: id,
      ...ctx,
    })
    return updated
  }

  /**
   * Удаление помещения — только неиспользуемого: без пар в расписании, предстоящих
   * экзаменов и замен «перенос в ауд. X» на сегодня и дальше.
   *
   * Пары, экзамены и замены ссылаются на помещение с SET NULL: без проверки удаление молча
   * стирало аудиторию из будущих экзаменов и замен, и студенты не знали, куда идти. Прошедшие
   * экзамены и замены не мешают — им пустая аудитория уже ничего не ломает. В ответе — что
   * именно мешает (details.field — вид записей).
   *
   * Подсчёт и удаление — одна транзакция под блокировкой строки помещения (FOR UPDATE):
   * пара, экзамен или замена, заведённые параллельно, проверяют внешний ключ (FOR KEY SHARE
   * на строку помещения) и либо попадают в подсчёт, либо ждут удаления и падают на ключе.
   */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const room = await this.findOrThrow(id)
    this.assertManageScope(actor, room.universityId)
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "rooms" WHERE id = ${id} FOR UPDATE`
      const blockers = await this.deletionBlockers(tx, id)
      if (blockers.length > 0) {
        throw new AppException(
          'CONFLICT',
          `Нельзя удалить помещение, пока его используют: ${blockers.map((b) => b.message).join(', ')}`,
          blockers,
        )
      }
      await tx.room.delete({ where: { id } })
    })
    await this.universities.invalidateStats(room.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'room_deleted',
      entity: 'Room',
      entityId: id,
      ...ctx,
    })
  }

  /**
   * Проверка для расписания (Ф6.4): аудитория существует и принадлежит указанному вузу.
   * Экспортируется через RoomService, чтобы SchedulesModule не обращался к таблице rooms «в лоб».
   */
  async assertRoomInUniversity(roomId: string, universityId: string): Promise<void> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { universityId: true },
    })
    if (!room) {
      throw new AppException('NOT_FOUND', 'Аудитория не найдена')
    }
    if (room.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Аудитория другого университета')
    }
  }

  /**
   * Что держит помещение от удаления. «Предстоящее» — с начала сегодняшних суток по UTC:
   * для вузов восточнее Гринвича это захватывает и часть вчерашнего дня — лишний отказ
   * лучше, чем потерянная аудитория у сегодняшнего экзамена.
   *
   * Счётчики по чужим таблицам — напрямую, как и прежняя проверка пар (и как
   * `GroupService.deletionBlockers`): подсчёт обязан идти в транзакции удаления, под
   * блокировкой строки помещения. Наружу отсюда идут только числа.
   */
  private async deletionBlockers(
    tx: Prisma.TransactionClient,
    roomId: string,
  ): Promise<{ field: RoomDeletionBlocker; message: string }[]> {
    const today = new Date(new Date().toISOString().slice(0, 10))
    const counts: Record<RoomDeletionBlocker, number> = {
      pairs: await tx.pair.count({ where: { roomId } }),
      exams: await tx.exam.count({ where: { roomId, date: { gte: today } } }),
      changes: await tx.scheduleChange.count({
        where: { newRoomId: roomId, date: { gte: today } },
      }),
    }
    return ROOM_DELETION_BLOCKERS.filter((field) => counts[field] > 0).map((field) => ({
      field,
      message: `${ROOM_DELETION_LABELS[field]} (${counts[field]})`,
    }))
  }

  private async findOrThrow(id: string): Promise<RoomDto> {
    const room = await this.prisma.room.findUnique({ where: { id }, select: ROOM_SELECT })
    if (!room) {
      throw new AppException('NOT_FOUND', 'Аудитория не найдена')
    }
    return room
  }

  private listWhere(viewer: JwtPayload, universityId?: string): Prisma.RoomWhereInput {
    if (isPlatform(viewer.role)) {
      return universityId ? { universityId } : {}
    }
    return { universityId: viewer.universityId ?? '__none__' }
  }

  // Чтение: платформа — любая; прочие — только свой вуз.
  private assertReadScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) return
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
  }

  // Управление: платформа или админ своего вуза.
  private assertManageScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) return
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
  }
}
