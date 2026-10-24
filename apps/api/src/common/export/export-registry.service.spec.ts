import type { PrismaService } from '../prisma/prisma.service'
import {
  ExportRegistryService,
  FREE_TEXT_MARK,
  VERIFIABLE_EXPORT_KINDS,
} from './export-registry.service'
import type { ExportContext } from './export-branding.types'

function setup(create: jest.Mock) {
  const documentExport = {
    create,
    findUnique: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  }
  const tx = { documentExport, $executeRaw: jest.fn().mockResolvedValue(0) }
  const prisma = {
    documentExport,
    $executeRaw: tx.$executeRaw,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  return {
    service: new ExportRegistryService(prisma as unknown as PrismaService),
    prisma,
  }
}

const certificate: ExportContext = {
  kind: 'certificate',
  actor: { id: 'dean-1', fullName: 'Иванова Елена' },
  locale: 'ru',
  timezone: 'Asia/Almaty',
  generatedAt: new Date('2026-09-12T21:30:00Z'),
}

const context: ExportContext = {
  kind: 'users',
  actor: { id: 'adm-1', fullName: 'Асанов Асан' },
  locale: 'ru',
  timezone: 'Asia/Almaty',
  generatedAt: new Date('2026-09-12T21:30:00Z'),
  params: { role: 'STUDENT', search: '', facultyId: null },
}

describe('ExportRegistryService', () => {
  it('выдаёт код без визуально похожих символов — его читают с бумаги', async () => {
    const create = jest.fn(async ({ data }: { data: { shortId: string } }) => ({
      id: 'e-1',
      shortId: data.shortId,
    }))
    const { service } = setup(create)

    const record = await service.register({ context, format: 'xlsx', rows: 42 })

    // Нет 0/O и 1/I/L: их путают при наборе с наклейки или колонтитула.
    expect(record?.shortId).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
  })

  it('пустые фильтры в журнал не попадают', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' })
    const { service } = setup(create)

    await service.register({ context, format: 'xlsx', rows: 42, ip: '10.0.0.1' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'users',
          format: 'xlsx',
          rows: 42,
          ip: '10.0.0.1',
          // search: '' и facultyId: null выброшены — по ним ничего не восстановить.
          params: { role: 'STUDENT' },
        }),
      }),
    )
  })

  it('строка поиска в бессрочный журнал не попадает — только пометка (BUG-195)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' })
    const { service } = setup(create)

    await service.register({
      context: { ...context, params: { role: 'STUDENT', search: 'aruzhan@u.kz Оспанова' } },
      format: 'csv',
    })

    const data = (create.mock.calls[0]?.[0] as { data: { params: Record<string, string> } }).data
    expect(data.params).toEqual({ role: 'STUDENT', search: FREE_TEXT_MARK })
    expect(JSON.stringify(data)).not.toContain('Оспанова')
  })

  it('сбой записи не роняет выгрузку, но возвращает null', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('relation "document_exports" does not exist'))
    const { service } = setup(create)

    // Человек просил файл, а не запись в журнале. Но вызывающая сторона обязана увидеть
    // null: официальный документ без записи в журнале выдавать нельзя.
    await expect(service.register({ context, format: 'csv' })).resolves.toBeNull()
  })

  // D-F19: два одновременных «Сформировать справку» раньше оба проходили проверку чтением.
  describe('registerExclusive — официальный документ по номеру один', () => {
    const doc = { subjectName: 'Оспанова Аружан', documentNumber: 'SH-2026-000042' }

    it('действующего нет — записывает под локом номера', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' })
      const { service, prisma } = setup(create)

      const record = await service.registerExclusive({
        context: certificate,
        format: 'pdf',
        document: doc,
      })

      expect(record).toEqual({ id: 'e-1', shortId: 'ABCD2345' })
      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(prisma.documentExport.count).toHaveBeenCalledWith({
        where: { documentNumber: 'SH-2026-000042', kind: 'certificate', revokedAt: null },
      })
    })

    it('действующий уже есть — «active», вторая запись не создаётся', async () => {
      const create = jest.fn()
      const { service, prisma } = setup(create)
      prisma.documentExport.count.mockResolvedValue(1)

      await expect(
        service.registerExclusive({ context: certificate, format: 'pdf', document: doc }),
      ).resolves.toBe('active')
      expect(create).not.toHaveBeenCalled()
    })

    it('сбой журнала — null, как у register', async () => {
      const create = jest.fn().mockRejectedValue(new Error('db down'))
      const { service } = setup(create)

      await expect(
        service.registerExclusive({ context: certificate, format: 'pdf', document: doc }),
      ).resolves.toBeNull()
    })
  })

  // D-F23: публичная проверка резолвила коды любых выгрузок.
  describe('findByShortId — только официальные документы', () => {
    it('ищет код только среди проверяемых видов', async () => {
      const { service, prisma } = setup(jest.fn())

      await expect(service.findByShortId('USERS234')).resolves.toBeNull()
      expect(prisma.documentExport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shortId: 'USERS234', kind: { in: [...VERIFIABLE_EXPORT_KINDS] } },
        }),
      )
      expect(VERIFIABLE_EXPORT_KINDS).toEqual(['certificate'])
    })

    it('ФИО — фамилия с инициалами', async () => {
      const { service, prisma } = setup(jest.fn())
      prisma.documentExport.findFirst.mockResolvedValue({
        shortId: 'JT9ZPNDD',
        kind: 'certificate',
        documentNumber: 'SH-2026-000042',
        issuerName: 'Алатауский университет',
        subjectName: 'Оспанова Аружан Бауыржановна',
        createdAt: new Date('2026-09-12T21:30:00Z'),
        revokedAt: null,
      })

      const found = await service.findByShortId('JT9ZPNDD')
      expect(found?.subject).toBe('Оспанова А.Б.')
    })
  })

  it('отзыв по номеру идёт через переданную транзакцию', async () => {
    const { service, prisma } = setup(jest.fn())
    const tx = { documentExport: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } }

    await expect(service.revokeByDocumentNumber('SH-1', 'certificate', tx as never)).resolves.toBe(
      2,
    )
    expect(tx.documentExport.updateMany).toHaveBeenCalled()
    expect(prisma.documentExport.updateMany).not.toHaveBeenCalled()
  })
})
