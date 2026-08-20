import { Role } from '@studenthub/shared-types'
import { RoomQrService, wallClockNow } from './room-qr.service'
import { formatCode, randomCode } from './room-code'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'

// Библиотека qrcode (вместе с PNG-кодировщиком pngjs) грузится через резолвер Jest
// ~1.5 с — на CI-раннере втрое дольше, и тест выдачи кода упирался в таймаут 5 с
// (само кодирование картинки при этом занимает ~57 мс). Кодирование PNG — не наша
// логика; подменяем библиотеку и проверяем, ЧТО мы ей передаём. Реальная генерация
// проверена сквозным прогоном в браузере: наклейка печатается и сканируется.
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,stub'),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as { toDataURL: jest.Mock }

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    room: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    pair: { findMany: jest.fn().mockResolvedValue([]) },
    scheduleChange: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }
  const service = new RoomQrService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, audit }
}

function viewer(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

const room = (over: Record<string, unknown> = {}) => ({
  id: 'room-1',
  name: '305',
  kind: 'AUDITORIUM',
  building: 'Б',
  floor: 3,
  capacity: 30,
  openHours: null,
  phone: null,
  info: null,
  qrCode: 'ABCD2345',
  qrIssuedAt: new Date('2026-08-20T00:00:00Z'),
  universityId: 'uni-1',
  university: { name: 'КазНУ', shortName: 'КазНУ', timezone: 'Asia/Almaty' },
  ...over,
})

const pair = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  scheduleId: 's-1',
  groupId: 'g-1',
  subject: 'Матанализ',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:30',
  weekType: 'BOTH',
  group: { id: 'g-1', name: 'ИТ-24-1' },
  teacher: { id: 't-1', firstName: 'Асель', lastName: 'Нурлан' },
  room: { id: 'room-1', name: '305' },
  ...over,
})

// ── статус по коду из QR ─────────────────────────────────────────────────────

describe('RoomQrService.statusByCode', () => {
  it('отдаёт помещение, «сейчас» по серверу и пары дня', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(room())
    prisma.$transaction.mockResolvedValue([[pair()], []])

    const result = await service.statusByCode(viewer(Role.STUDENT), 'ABCD2345')

    expect(result.room.name).toBe('305')
    expect(result.academic).toBe(true)
    expect(result.timezone).toBe('Asia/Almaty')
    // «Сейчас» приходит с сервера: часы на телефоне студента могут врать.
    expect(result.now).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      time: expect.stringMatching(/^\d{2}:\d{2}$/),
      dayOfWeek: expect.any(Number),
    })
    // Имя группы обязательно: главный вопрос сканирующего — «кто здесь сейчас».
    expect(result.pairs[0]).toMatchObject({ group: { name: 'ИТ-24-1' } })
  })

  it('неизвестный код — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(null)

    await expect(service.statusByCode(viewer(Role.STUDENT), 'NOPE1234')).rejects.toThrow(
      AppException,
    )
  })

  it('помещение чужого вуза — тот же NOT_FOUND, а не WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(room({ universityId: 'uni-2' }))

    // Наклейка висит в открытом коридоре: по коду нельзя выяснить, существует ли
    // помещение в другом вузе — иначе код становится оракулом для перебора.
    await expect(
      service.statusByCode(viewer(Role.STUDENT, 'uni-1'), 'ABCD2345'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('платформенная роль видит помещение любого вуза', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(room({ universityId: 'uni-9' }))
    prisma.$transaction.mockResolvedValue([[], []])

    const result = await service.statusByCode(viewer(Role.PLATFORM_ADMIN, null), 'ABCD2345')

    expect(result.room.id).toBe('room-1')
  })

  it('для библиотеки не ходит в расписание — там пар не бывает', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(
      room({ kind: 'LIBRARY', openHours: 'Пн–Пт 09:00–18:00', phone: '+7 700 000 00 00' }),
    )

    const result = await service.statusByCode(viewer(Role.STUDENT), 'ABCD2345')

    expect(result.academic).toBe(false)
    expect(result.pairs).toEqual([])
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(result.room.openHours).toBe('Пн–Пт 09:00–18:00')
  })

  it('включает пары, перенесённые в это помещение сегодня', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(room())
    const movedIn = pair({ id: 'p-2', subject: 'Физика', room: { id: 'room-9', name: '111' } })
    prisma.$transaction.mockImplementation(() => {
      // Первый запрос — пары по roomId, второй — переносы В это помещение.
      const now = wallClockNow('Asia/Almaty')
      return Promise.resolve([[pair()], [{ pair: { ...movedIn, dayOfWeek: now.dayOfWeek } }]])
    })
    prisma.scheduleChange.findMany.mockResolvedValue([])

    const result = await service.statusByCode(viewer(Role.STUDENT), 'ABCD2345')

    expect(result.pairs.map((p) => p.id)).toContain('p-2')
  })

  it('не дублирует пару, если она и в расписании, и в переносе', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(room())
    prisma.$transaction.mockResolvedValue([[pair()], [{ pair: pair() }]])

    const result = await service.statusByCode(viewer(Role.STUDENT), 'ABCD2345')

    expect(result.pairs).toHaveLength(1)
  })
})

// ── выдача и перевыпуск кодов ────────────────────────────────────────────────

describe('RoomQrService.issueBatch', () => {
  it('не меняет уже выданный код — иначе печать обесценит висящие наклейки', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.findMany.mockResolvedValue([room()])

    const [dto] = await service.issueBatch(viewer(Role.UNIVERSITY_ADMIN), ['room-1'], ctx)

    expect(dto?.code).toBe('ABCD2345')
    expect(prisma.room.update).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('выдаёт код помещению без кода и пишет в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.findMany.mockResolvedValue([room({ qrCode: null, qrIssuedAt: null })])
    prisma.room.update.mockResolvedValue({ id: 'room-1' })

    const [dto] = await service.issueBatch(viewer(Role.UNIVERSITY_ADMIN), ['room-1'], ctx)

    expect(dto?.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
    expect(dto?.url).toBe(`https://app.studenthub.kz/r/${dto?.code}`)
    // Картинка для печати генерируется на сервере (qrcode уже есть в зависимостях).
    expect(dto?.qr.startsWith('data:image/png;base64,')).toBe(true)
    // Параметры печати — наша логика: коррекция выше средней, потому что наклейку
    // на двери заляпают и поцарапают, и запас по ширине для печати.
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      dto?.url,
      expect.objectContaining({ errorCorrectionLevel: 'Q', width: 600, margin: 1 }),
    )
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'room_qr_issued' }))
  })

  it('админ чужого вуза получает WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.room.findMany.mockResolvedValue([room({ universityId: 'uni-2' })])

    await expect(
      service.issueBatch(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), ['room-1'], ctx),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })
})

describe('RoomQrService.rotate', () => {
  it('выдаёт новый код и сохраняет прежний в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.findUnique.mockResolvedValue(room())
    prisma.room.update.mockResolvedValue({ id: 'room-1' })

    const dto = await service.rotate(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx)

    expect(dto.code).not.toBe('ABCD2345')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'room_qr_rotated',
        metadata: expect.objectContaining({ previousCode: 'ABCD2345' }),
      }),
    )
  })
})

// ── «настенное» время и код ──────────────────────────────────────────────────

describe('wallClockNow', () => {
  it('считает дату и день недели в таймзоне вуза, а не в UTC', () => {
    // 2026-08-20 20:30 UTC = 2026-08-21 01:30 в Алматы (UTC+5): другой день И другой день недели.
    const at = new Date('2026-08-20T20:30:00Z')

    expect(wallClockNow('Asia/Almaty', at)).toEqual({
      date: '2026-08-21',
      time: '01:30',
      dayOfWeek: 5,
    })
    expect(wallClockNow('UTC', at)).toEqual({
      date: '2026-08-20',
      time: '20:30',
      dayOfWeek: 4,
    })
  })

  it('без таймзоны вуза считает по UTC, а не по таймзоне сервера', () => {
    expect(wallClockNow(null, new Date('2026-08-20T20:30:00Z')).date).toBe('2026-08-20')
  })
})

describe('код помещения', () => {
  it('не содержит визуально похожих символов — код печатается текстом', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomCode()).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
    }
  })

  it('форматируется группами по 4 — так его набирают вручную', () => {
    expect(formatCode('ABCD2345')).toBe('ABCD-2345')
  })
})
