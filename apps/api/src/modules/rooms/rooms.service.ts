import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { CreateRoomInput, UpdateRoomInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const ROOM_SELECT = {
  id: true,
  name: true,
  capacity: true,
  universityId: true,
  createdAt: true,
} satisfies Prisma.RoomSelect

type RoomDto = Prisma.RoomGetPayload<{ select: typeof ROOM_SELECT }>

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class RoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Создание аудитории (PLATFORM_ADMIN / UNIVERSITY_ADMIN своего вуза). */
  async create(actor: JwtPayload, input: CreateRoomInput, ctx: RequestContext): Promise<RoomDto> {
    this.assertManageScope(actor, input.universityId)
    const university = await this.prisma.university.findUnique({
      where: { id: input.universityId },
      select: { id: true },
    })
    if (!university) {
      throw new AppException('NOT_FOUND', 'Университет не найден')
    }
    const room = await this.prisma.room.create({
      data: { name: input.name, capacity: input.capacity, universityId: input.universityId },
      select: ROOM_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'room_created',
      entity: 'Room',
      entityId: room.id,
      metadata: { universityId: input.universityId },
      ...ctx,
    })
    return room
  }

  /** Список аудиторий по scope смотрящего. */
  async list(
    viewer: JwtPayload,
    page: number,
    limit: number,
    universityId?: string,
  ): Promise<Paginated<RoomDto>> {
    const where = this.listWhere(viewer, universityId)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        orderBy: { name: 'asc' },
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
      data: { name: input.name, capacity: input.capacity ?? undefined },
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

  /** Удаление аудитории — запрещено, пока она используется в парах (иначе SET NULL «потеряет» аудиторию). */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const room = await this.findOrThrow(id)
    this.assertManageScope(actor, room.universityId)
    const usedBy = await this.prisma.pair.count({ where: { roomId: id } })
    if (usedBy > 0) {
      throw new AppException('CONFLICT', 'Нельзя удалить аудиторию, занятую в расписании')
    }
    await this.prisma.room.delete({ where: { id } })
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
