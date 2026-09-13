import type { PrismaService } from '../prisma/prisma.service'
import { ExportRegistryService } from './export-registry.service'
import type { ExportContext } from './export-branding.types'

function setup(create: jest.Mock) {
  const prisma = { documentExport: { create, findUnique: jest.fn() } }
  return {
    service: new ExportRegistryService(prisma as unknown as PrismaService),
    prisma,
  }
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

  it('сбой записи не роняет выгрузку, но возвращает null', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('relation "document_exports" does not exist'))
    const { service } = setup(create)

    // Человек просил файл, а не запись в журнале. Но вызывающая сторона обязана увидеть
    // null: официальный документ без записи в журнале выдавать нельзя.
    await expect(service.register({ context, format: 'csv' })).resolves.toBeNull()
  })
})
