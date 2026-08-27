import { KatoService } from './kato.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

function setup() {
  const prisma = {
    katoUnit: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  }
  const service = new KatoService(prisma as unknown as PrismaService)
  return { service, prisma }
}

const ALMATY = {
  code: '750000000',
  kind: 'CITY',
  nameRu: 'Алматы',
  nameKk: 'Алматы',
  regionCode: '750000000',
}
const KOKSHETAU = {
  code: '111010000',
  kind: 'CITY',
  nameRu: 'Кокшетау',
  nameKk: 'Көкшетау',
  regionCode: '110000000',
}
const AKMOLA = { code: '110000000', nameRu: 'Акмолинская', nameKk: 'Ақмола' }

describe('KatoService — поиск', () => {
  it('scope=places ограничивает выборку населёнными пунктами', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await service.search({ search: 'абай', scope: 'places', limit: 20 })

    const where = prisma.katoUnit.findMany.mock.calls[0][0].where
    expect(where.kind.in).toEqual(['CITY', 'SETTLEMENT', 'VILLAGE', 'STATION', 'OTHER'])
  })

  it('scope=all не фильтрует по виду — районы и округа тоже видны', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await service.search({ scope: 'all', limit: 20 })

    expect(prisma.katoUnit.findMany.mock.calls[0][0].where.kind).toBeUndefined()
  })

  it('ищет по обоим языкам: «Оскемен» и «Усть-Каменогорск» — один город', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await service.search({ search: 'Өскемен', scope: 'places', limit: 20 })

    const or = prisma.katoUnit.findMany.mock.calls[0][0].where.OR
    expect(or).toEqual([
      { nameRu: { contains: 'Өскемен', mode: 'insensitive' } },
      { nameKk: { contains: 'Өскемен', mode: 'insensitive' } },
    ])
  })

  it('limit доходит до take — выборка без потолка запрещена', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await service.search({ search: 'абай', scope: 'places', limit: 7 })

    expect(prisma.katoUnit.findMany.mock.calls[0][0].take).toBe(7)
  })
})

describe('KatoService — список по умолчанию', () => {
  it('без поиска отдаёт крупные города, а не первые попавшиеся по алфавиту', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValue([ALMATY])
    prisma.katoUnit.findMany.mockResolvedValue([])

    await service.search({ scope: 'places', limit: 20 })

    // Обычный поиск по таблице в этой ветке не выполняется — иначе список был бы алфавитным.
    expect(prisma.katoUnit.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: expect.anything() }),
    )
    const sql = prisma.$queryRaw.mock.calls[0][0].join('?')
    expect(sql).toContain("'__1010000'")
  })

  it('пустой список по умолчанию только для населённых пунктов; scope=all идёт обычным путём', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValue([])

    await service.search({ scope: 'all', limit: 20 })

    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('KatoService — подпись региона', () => {
  it('дополняет населённый пункт названием его области', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([KOKSHETAU]).mockResolvedValueOnce([AKMOLA])

    const [city] = await service.search({ search: 'Кокшетау', scope: 'places', limit: 20 })

    expect(city).toMatchObject({ nameRu: 'Кокшетау', regionNameRu: 'Акмолинская' })
  })

  it('город республиканского значения не подписывается сам собой', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([ALMATY]).mockResolvedValueOnce([ALMATY])

    const [city] = await service.search({ search: 'Алматы', scope: 'places', limit: 20 })

    // Опциональная цепочка — из-за noUncheckedIndexedAccess: если строки нет,
    // проверка всё равно упадёт (undefined не равен null).
    expect(city?.regionNameRu).toBeNull()
  })
})

describe('KatoService — регионы', () => {
  it('верхний уровень берётся предикатом region_code = code, а не kind = REGION', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValue([ALMATY, KOKSHETAU])
    prisma.katoUnit.findMany.mockResolvedValue([AKMOLA])

    await service.search({ scope: 'regions', limit: 20 })

    const sql = prisma.$queryRaw.mock.calls[0][0].join('?')
    expect(sql).toContain('"region_code" = "code"')
    expect(prisma.katoUnit.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: 'REGION' }) }),
    )
  })

  it('поиск по регионам фильтрует и обрезает по limit', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValue([ALMATY, KOKSHETAU])
    prisma.katoUnit.findMany.mockResolvedValue([])

    const found = await service.search({ search: 'алмат', scope: 'regions', limit: 20 })

    expect(found.map((r) => r.code)).toEqual(['750000000'])
  })
})

describe('KatoService — резолв кодов', () => {
  it('take равен числу запрошенных кодов', async () => {
    const { service, prisma } = setup()
    prisma.katoUnit.findMany.mockResolvedValueOnce([ALMATY]).mockResolvedValueOnce([ALMATY])

    await service.resolve({ codes: ['750000000', '110000000'] })

    expect(prisma.katoUnit.findMany.mock.calls[0][0].take).toBe(2)
  })
})
