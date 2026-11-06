import { Role } from '@studenthub/shared-types'
import { LibraryIdAccessService } from './library-id-access.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Удостоверение читателя на время выдачи (Фаза 20.6).

const ctx = { ip: '10.0.0.7', userAgent: 'jest' }
const librarian: JwtPayload = {
  sub: 'lib-1',
  role: Role.LIBRARIAN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(loan: Record<string, unknown> | null) {
  const prisma = {
    loan: { findUnique: jest.fn().mockResolvedValue(loan) },
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'stu-1',
        universityId: 'uni-1',
        firstName: 'Нурлан',
        lastName: 'Оспанов',
        middleName: null,
        avatarUrl: null,
        avatarThumbUrl: null,
        studentCardNumber: '42',
        academicStatus: 'Обучается',
        course: 2,
        group: { name: 'ИТ-23-1' },
        faculty: { name: 'ИТ' },
      }),
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Анна', lastName: 'Ким' }),
    },
    libraryIdAccessLog: {
      create: jest.fn().mockResolvedValue({ createdAt: new Date('2026-10-22T10:00:00Z') }),
    },
  }
  const loans = { timezoneOf: jest.fn().mockResolvedValue('Asia/Almaty') }
  return { service: new LibraryIdAccessService(prisma as never, loans as never), prisma }
}

const openLoan = {
  id: 'loan-1',
  universityId: 'uni-1',
  status: 'OPEN',
  readerId: 'stu-1',
  readerName: 'Оспанов Нурлан',
  bookTitle: 'Русская литература',
  inventoryNumber: '101',
  issuedAt: new Date('2026-10-01T05:00:00Z'),
  dueAt: new Date('2026-10-15T18:59:59.999Z'),
}

describe('Удостоверение по выдаче', () => {
  it('открытая выдача — карточка без лишнего и строка журнала с IP', async () => {
    const { service, prisma } = setup(openLoan)
    const card = await service.readerCard(librarian, 'loan-1', ctx)
    expect(card.reader).toMatchObject({ lastName: 'Оспанов', group: 'ИТ-23-1' })
    expect(card.reader).not.toHaveProperty('birthDate')
    expect(card.loan.dueDate).toBe('2026-10-15')
    expect(prisma.libraryIdAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loanId: 'loan-1',
          librarianId: 'lib-1',
          librarianName: 'Ким Анна',
          readerId: 'stu-1',
          ip: '10.0.0.7',
        }),
      }),
    )
  })

  it('после возврата — 403, в журнал не пишется', async () => {
    const { service, prisma } = setup({ ...openLoan, status: 'RETURNED' })
    await expect(service.readerCard(librarian, 'loan-1', ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prisma.libraryIdAccessLog.create).not.toHaveBeenCalled()
  })

  it('выдача чужого вуза — 404', async () => {
    const { service } = setup({ ...openLoan, universityId: 'uni-2' })
    await expect(service.readerCard(librarian, 'loan-1', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('админ вуза карточку не открывает — только библиотекарь', async () => {
    const { service } = setup(openLoan)
    await expect(
      service.readerCard({ ...librarian, role: Role.UNIVERSITY_ADMIN }, 'loan-1', ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
