import { visibleServicesWhere } from './service-visibility'
import type { PrismaService } from '../../common/prisma/prisma.service'

function prismaWith(codes: string[]) {
  const findMany = jest.fn().mockResolvedValue(codes.map((code) => ({ code })))
  return { prisma: { applicationService: { findMany } } as unknown as PrismaService, findMany }
}

describe('visibleServicesWhere', () => {
  it('копия вуза скрывает одноимённый шаблон, услуги вуза видны', async () => {
    const { prisma, findMany } = prismaWith(['study-certificate'])

    const where = await visibleServicesWhere(prisma, 'uni-1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: 'uni-1' } }),
    )
    expect(where).toEqual({
      active: true,
      OR: [
        { universityId: null, code: { notIn: ['study-certificate'] } },
        { universityId: 'uni-1' },
      ],
    })
  })

  it('без своих услуг вуз видит все шаблоны', async () => {
    const { prisma } = prismaWith([])
    const where = await visibleServicesWhere(prisma, 'uni-1')
    expect(where).toEqual({ active: true, OR: [{ universityId: null }, { universityId: 'uni-1' }] })
  })

  it('без вуза — только шаблоны, без запроса кодов', async () => {
    const { prisma, findMany } = prismaWith([])
    const where = await visibleServicesWhere(prisma, null)
    expect(where).toEqual({ active: true, universityId: null })
    expect(findMany).not.toHaveBeenCalled()
  })
})
