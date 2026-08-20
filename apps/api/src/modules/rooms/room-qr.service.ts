import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as QRCode from 'qrcode'
import { Prisma, RoomKind } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { isAcademicRoomKind } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { webBaseUrl } from '../../config/web-base'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { randomCode } from './room-code'

// Ф16 «QR помещения»: печатная наклейка над дверью. Студент сканирует камерой телефона
// и видит, свободно ли помещение, какая пара идёт и какая группа в нём сейчас;
// для библиотеки/бухгалтерии/актового зала — часы работы и контакт.
//
// Ключевые решения:
//   • QR ведёт на страницу веб-приложения (`/r/<code>`), а не содержит данные. Значит
//     наклейка не устаревает вместе с данными и работает штатной камерой без установки
//     приложения.
//   • Страница требует авторизации (middleware): расписание группы — внутренние данные
//     вуза (§1 «платформа полностью закрыта»), а наклейка висит в открытом коридоре.
//   • Код короткий и отдельный от id: плотность QR ниже (читается с расстояния),
//     а перевыпуск обесценивает утёкшую/устаревшую распечатку.

const QR_PRINT_WIDTH = 600

const ROOM_QR_SELECT = {
  id: true,
  name: true,
  kind: true,
  building: true,
  floor: true,
  capacity: true,
  // Для неучебных помещений часы работы печатаются прямо на наклейке: у двери библиотеки
  // или бухгалтерии это нужнее, чем возможность отсканировать.
  openHours: true,
  qrCode: true,
  qrIssuedAt: true,
  universityId: true,
  university: { select: { name: true, shortName: true } },
} satisfies Prisma.RoomSelect

const STATUS_ROOM_SELECT = {
  ...ROOM_QR_SELECT,
  phone: true,
  info: true,
  university: { select: { name: true, shortName: true, timezone: true } },
} satisfies Prisma.RoomSelect

// Пара в помещении: как в расписании (§8.3), но с ИМЕНЕМ ГРУППЫ — на QR-странице главный
// вопрос «какая группа сейчас здесь», а groupId студенту ничего не говорит.
const ROOM_PAIR_SELECT = {
  id: true,
  scheduleId: true,
  groupId: true,
  subject: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  weekType: true,
  group: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.PairSelect

const ROOM_CHANGE_SELECT = {
  id: true,
  pairId: true,
  type: true,
  date: true,
  newStartTime: true,
  newEndTime: true,
  note: true,
  createdAt: true,
  newRoom: { select: { id: true, name: true } },
  newTeacher: { select: { id: true, firstName: true, lastName: true } },
  pair: {
    select: { groupId: true, subject: true, dayOfWeek: true, startTime: true, endTime: true },
  },
} satisfies Prisma.ScheduleChangeSelect

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class RoomQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Выдать QR пачкой (печать наклеек на этаж/корпус). Идемпотентно: у помещения с уже
   * выданным кодом код НЕ меняется — иначе печать одной наклейки обесценила бы все
   * висящие. Новый код только через `rotate`.
   */
  async issueBatch(actor: JwtPayload, roomIds: string[], ctx: RequestContext) {
    const rooms = await this.prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: ROOM_QR_SELECT,
      take: roomIds.length,
    })
    if (rooms.length === 0) {
      throw new AppException('NOT_FOUND', 'Помещения не найдены')
    }
    for (const room of rooms) {
      this.assertManageScope(actor, room.universityId)
    }

    const issued: string[] = []
    for (const room of rooms) {
      if (!room.qrCode) {
        const code = await this.assignCode(room.id)
        room.qrCode = code
        room.qrIssuedAt = new Date()
        issued.push(room.id)
      }
    }
    if (issued.length > 0) {
      await this.audit.record({
        userId: actor.sub,
        action: 'room_qr_issued',
        entity: 'Room',
        entityId: issued[0] as string,
        metadata: { roomIds: issued, count: issued.length },
        ...ctx,
      })
    }

    return Promise.all(rooms.map((room) => this.toQrDto(room)))
  }

  /**
   * Перевыпуск кода: старая распечатка перестаёт работать. Нужен, когда помещение
   * перепрофилировали или наклейка ушла наружу. Пишется в аудит — действие необратимо
   * для уже расклеенных наклеек.
   */
  async rotate(actor: JwtPayload, roomId: string, ctx: RequestContext) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: ROOM_QR_SELECT,
    })
    if (!room) {
      throw new AppException('NOT_FOUND', 'Помещение не найдено')
    }
    this.assertManageScope(actor, room.universityId)

    const previous = room.qrCode
    const code = await this.assignCode(room.id)
    await this.audit.record({
      userId: actor.sub,
      action: 'room_qr_rotated',
      entity: 'Room',
      entityId: room.id,
      // Прежний код — в аудит: по нему потом понятно, какая распечатка перестала работать.
      metadata: { previousCode: previous, universityId: room.universityId },
      ...ctx,
    })
    return this.toQrDto({ ...room, qrCode: code, qrIssuedAt: new Date() })
  }

  /**
   * Статус помещения по коду из QR — то, что видит студент после сканирования.
   *
   * Отдаём СЫРЫЕ данные дня (пары + изменения + «сейчас» по часам сервера в таймзоне вуза),
   * а «занято/свободно» считает клиент теми же хелперами, что и сетка расписания и экран
   * «Сегодня» (`buildDayPairs`/`isoWeekParity`). Иначе два источника истины разошлись бы:
   * страница по QR показывала бы одно, расписание — другое.
   */
  async statusByCode(viewer: JwtPayload, code: string) {
    const room = await this.prisma.room.findUnique({
      where: { qrCode: code },
      select: STATUS_ROOM_SELECT,
    })
    // Тот же ответ, что и для чужого вуза: по коду нельзя выяснить, существует ли помещение
    // в другом вузе (наклейка висит в открытом доступе).
    if (!room || !this.canRead(viewer, room.universityId)) {
      throw new AppException('NOT_FOUND', 'Помещение не найдено или код устарел')
    }

    const timezone = room.university.timezone
    const now = wallClockNow(timezone)
    const academic = isAcademicRoomKind(room.kind as never)

    // У неучебных помещений пар не бывает — не ходим в расписание вовсе.
    const { pairs, changes } = academic
      ? await this.dayInRoom(room.id, now)
      : { pairs: [], changes: [] }

    return {
      room: {
        id: room.id,
        name: room.name,
        kind: room.kind,
        building: room.building,
        floor: room.floor,
        capacity: room.capacity,
        openHours: room.openHours,
        phone: room.phone,
        info: room.info,
        university: room.university.name,
        universityShort: room.university.shortName,
      },
      academic,
      timezone,
      // «Сейчас» по серверу: часы на телефоне студента могут врать, а страница-киоск
      // должна показывать состояние помещения, а не состояние чужих часов.
      now,
      pairs,
      changes,
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Пары этого дня в помещении + перенесённые В него, вместе с изменениями на сегодня. */
  private async dayInRoom(roomId: string, now: WallClock) {
    const [scheduled, movedIn] = await this.prisma.$transaction([
      this.prisma.pair.findMany({
        where: { roomId, dayOfWeek: now.dayOfWeek, schedule: { isActive: true } },
        select: ROOM_PAIR_SELECT,
        orderBy: { startTime: 'asc' },
        take: 50,
      }),
      // Пары, перенесённые в это помещение именно сегодня (ROOM_CHANGED/MOVED с newRoomId).
      this.prisma.scheduleChange.findMany({
        where: { newRoomId: roomId, date: new Date(now.date) },
        select: { pair: { select: ROOM_PAIR_SELECT } },
        take: 50,
      }),
    ])

    const byId = new Map(scheduled.map((p) => [p.id, p]))
    for (const { pair } of movedIn) {
      if (pair.dayOfWeek === now.dayOfWeek) byId.set(pair.id, pair)
    }
    const pairs = [...byId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))

    // Изменения на сегодня по этим парам: отмена, перенос по времени, смена аудитории
    // (в т.ч. ИЗ этого помещения — иначе показали бы занятость, которой уже нет).
    const changes =
      pairs.length === 0
        ? []
        : await this.prisma.scheduleChange.findMany({
            where: { pairId: { in: pairs.map((p) => p.id) }, date: new Date(now.date) },
            select: ROOM_CHANGE_SELECT,
            take: 100,
          })

    return { pairs, changes }
  }

  /** Уникальный короткий код с повтором при коллизии (unique-индекс на qr_code). */
  private async assignCode(roomId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode()
      try {
        await this.prisma.room.update({
          where: { id: roomId },
          data: { qrCode: code, qrIssuedAt: new Date() },
          select: { id: true },
        })
        return code
      } catch (error) {
        // P2002 — код уже занят: пробуем ещё раз. Остальное — не наша ошибка.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error
        }
      }
    }
    throw new AppException('INTERNAL_ERROR', 'Не удалось выдать код — повторите')
  }

  private async toQrDto(room: Prisma.RoomGetPayload<{ select: typeof ROOM_QR_SELECT }>) {
    const code = room.qrCode as string
    const url = `${webBaseUrl(this.config)}/r/${code}`
    return {
      roomId: room.id,
      name: room.name,
      kind: room.kind as RoomKind,
      building: room.building,
      floor: room.floor,
      capacity: room.capacity,
      openHours: room.openHours,
      university: room.university.name,
      universityShort: room.university.shortName,
      code,
      url,
      issuedAt: room.qrIssuedAt?.toISOString() ?? null,
      // Готовое изображение для печати: сервер уже умеет генерировать QR (qrcode,
      // студенческий билет), а фронт не тянет для этого ещё одну библиотеку.
      qr: await QRCode.toDataURL(url, {
        margin: 1,
        width: QR_PRINT_WIDTH,
        // Наклейку могут заляпать/поцарапать — берём коррекцию выше средней.
        errorCorrectionLevel: 'Q',
      }),
    }
  }

  private canRead(viewer: JwtPayload, universityId: string): boolean {
    return isPlatform(viewer.role) || viewer.universityId === universityId
  }

  private assertManageScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) return
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Помещение другого университета')
    }
  }
}

export interface WallClock {
  date: string
  time: string
  dayOfWeek: number
}

/**
 * «Настенные» дата/время/день недели в таймзоне вуза. Расписание хранит локальное время
 * (см. 03-schedule.prisma), поэтому сравнивать его с UTC нельзя.
 */
export function wallClockNow(timezone: string | null, at: Date = new Date()): WallClock {
  const tz = timezone ?? 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  // Intl отдаёт «24» для полуночи в некоторых локалях/движках — нормализуем.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
    dayOfWeek: days[get('weekday')] ?? 1,
  }
}
