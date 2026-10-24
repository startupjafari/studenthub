import { Role } from '@studenthub/shared-types'
import { LibraryCatalogService } from './library-catalog.service'
import { LibraryImportService, parseLibraryImportFile } from './library-import.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { FileService } from '../files/file.service'
import type { LibrarySettingsService } from './library-settings.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function actor(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

const librarian = actor(Role.LIBRARIAN)
const student = actor(Role.STUDENT)

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'book-1',
    universityId: 'uni-1',
    title: 'Русская литература',
    authors: 'Иванов И. И.',
    isbn: null,
    publisher: null,
    year: 2020,
    section: 'Литература',
    description: null,
    coverFileId: null,
    archivedAt: null,
    ...overrides,
  }
}

function copyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'copy-1',
    bookId: 'book-1',
    universityId: 'uni-1',
    inventoryNumber: '101',
    code: 'ABCD2345',
    status: 'AVAILABLE',
    condition: 'GOOD',
    note: 'Подклеен корешок',
    inventoriedAt: null,
    loans: [
      { id: 'loan-1', readerName: 'Оспанов Нурлан', readerGroup: 'ИТ-23-1', dueAt: new Date() },
    ],
    ...overrides,
  }
}

function setup({ enabled = true }: { enabled?: boolean } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ max: BigInt(120) }]),
    bookCopy: {
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: `copy-${data.inventoryNumber}` })),
    },
    book: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'book-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const prisma = {
    book: {
      findMany: jest.fn().mockResolvedValue([bookRow()]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(bookRow()),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(bookRow(data))),
    },
    bookCopy: {
      findMany: jest.fn().mockResolvedValue([copyRow()]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([
        { bookId: 'book-1', status: 'AVAILABLE', _count: { _all: 2 } },
        { bookId: 'book-1', status: 'ON_LOAN', _count: { _all: 1 } },
        { bookId: 'book-1', status: 'LOST', _count: { _all: 1 } },
      ]),
      update: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (t: typeof tx) => Promise<unknown>)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const files = { getPresignedUrls: jest.fn().mockResolvedValue(new Map()), upload: jest.fn() }
  const settings = {
    requireEnabled: jest
      .fn()
      .mockImplementation(() =>
        enabled
          ? Promise.resolve({ enabled: true })
          : Promise.reject(Object.assign(new Error('off'), { code: 'CONFLICT' })),
      ),
  }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }
  const reservations = {
    serveCopies: jest.fn().mockResolvedValue(undefined),
    serveBook: jest.fn().mockResolvedValue(undefined),
    closeQueueOfArchived: jest.fn().mockResolvedValue(undefined),
  }
  const service = new LibraryCatalogService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    files as unknown as FileService,
    settings as unknown as LibrarySettingsService,
    config as never,
    reservations as never,
  )
  return { service, prisma, tx, audit, settings, reservations }
}

describe('LibraryCatalogService — каталог', () => {
  it('наличие считает выданные и на полке, утерянные в фонд не входят', async () => {
    const { service } = setup()
    const page = await service.list(student, {
      page: 1,
      limit: 20,
      available: false,
      archived: false,
    })
    expect(page.items[0]?.availability).toEqual({ total: 3, available: 2, onLoan: 1, reserved: 0 })
  })

  it('читатель не видит каталог выключенной библиотеки, фонд — видит', async () => {
    const off = setup({ enabled: false })
    await expect(
      off.service.list(student, { page: 1, limit: 20, available: false, archived: false }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      off.service.list(librarian, { page: 1, limit: 20, available: false, archived: false }),
    ).resolves.toBeDefined()
  })

  it('архив скрыт от читателя даже по прямой ссылке', async () => {
    const { service, prisma } = setup()
    prisma.book.findUnique.mockResolvedValue(bookRow({ archivedAt: new Date() }))
    await expect(service.detail(student, 'book-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('фонду — книга с экземплярами и кому выдано; читателю — без экземпляров', async () => {
    const { service } = setup()
    const staff = await service.detail(librarian, 'book-1')
    expect(staff).toHaveProperty('copies')
    expect((staff as { copies: { loan: unknown }[] }).copies[0]?.loan).not.toBeNull()
    const reader = await service.detail(student, 'book-1')
    expect(reader).not.toHaveProperty('copies')
  })

  it('чужой вуз по коду наклейки — тот же 404, что и неизвестный код', async () => {
    const { service, prisma } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue({
      ...copyRow({ universityId: 'uni-2' }),
      book: bookRow(),
    })
    await expect(service.byCode(librarian, 'ABCD2345')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    prisma.bookCopy.findUnique.mockResolvedValue(null)
    await expect(service.byCode(librarian, 'ZZZZ2345')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('читатель по наклейке видит книгу, но не кому выдан экземпляр и не заметку', async () => {
    const { service, prisma } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue({ ...copyRow(), book: bookRow() })
    const found = await service.byCode(student, 'abcd2345')
    expect(found.copy.loan).toBeNull()
    expect(found.copy.note).toBeNull()
    expect(prisma.bookCopy.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'ABCD2345' } }),
    )
  })
})

describe('LibraryCatalogService — фонд', () => {
  it('книгу с выданным экземпляром в архив не убрать', async () => {
    const { service, prisma } = setup()
    prisma.bookCopy.count.mockResolvedValue(1)
    await expect(
      service.update(librarian, 'book-1', { archived: true }, ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'copies' })],
    })
  })

  it('книга ушла в архив — её очередь броней снимается', async () => {
    const { service, reservations } = setup()
    await service.update(librarian, 'book-1', { archived: true }, ctx)
    expect(reservations.closeQueueOfArchived).toHaveBeenCalledWith('book-1', expect.any(String))
  })

  it('читатель фонд не правит', async () => {
    const { service } = setup()
    await expect(service.update(student, 'book-1', { title: 'X' }, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('выданный экземпляр вручную не списать', async () => {
    const { service, prisma, tx } = setup()
    const owned = { id: 'copy-1', universityId: 'uni-1', bookId: 'book-1', code: 'X' }
    prisma.bookCopy.findUnique.mockResolvedValue({ ...owned, status: 'ON_LOAN' })
    tx.bookCopy.findUniqueOrThrow.mockResolvedValue({
      status: 'ON_LOAN',
      inventoryNumber: '101',
      universityId: 'uni-1',
    })
    await expect(
      service.updateCopy(librarian, 'copy-1', { status: 'WRITTEN_OFF' }, ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'status' })],
    })
    expect(tx.bookCopy.updateMany).not.toHaveBeenCalled()
  })

  it('номер выданного экземпляра не меняется: по нему принимают возврат', async () => {
    const { service, prisma, tx } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue({
      id: 'copy-1',
      universityId: 'uni-1',
      bookId: 'book-1',
      status: 'ON_LOAN',
      code: 'X',
    })
    tx.bookCopy.findUniqueOrThrow.mockResolvedValue({
      status: 'ON_LOAN',
      inventoryNumber: '101',
      universityId: 'uni-1',
    })
    await expect(
      service.updateCopy(librarian, 'copy-1', { inventoryNumber: '202' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'status' })] })
    expect(tx.bookCopy.updateMany).not.toHaveBeenCalled()
  })

  it('списание — под локом книги и условием на прежний статус: гонку с выдачей ловит запись', async () => {
    const { service, prisma, tx } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue({
      id: 'copy-1',
      universityId: 'uni-1',
      bookId: 'book-1',
      status: 'AVAILABLE',
      code: 'X',
    })
    tx.bookCopy.findUniqueOrThrow.mockResolvedValue({
      status: 'AVAILABLE',
      inventoryNumber: '101',
      universityId: 'uni-1',
    })
    tx.bookCopy.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.updateCopy(librarian, 'copy-1', { status: 'WRITTEN_OFF' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'status' })] })
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.bookCopy.updateMany).toHaveBeenCalledWith({
      where: { id: 'copy-1', status: 'AVAILABLE' },
      data: { status: 'WRITTEN_OFF' },
    })
  })

  it('номера по порядку продолжаются после наибольшего числового номера вуза', async () => {
    const { service, tx } = setup()
    const ids = await service.createCopies('uni-1', [
      { bookId: 'book-1', inventoryNumbers: [], count: 3 },
    ])
    expect(ids).toEqual(['copy-121', 'copy-122', 'copy-123'])
    expect(tx.$executeRaw).toHaveBeenCalled()
  })

  it('номера по порядку обходят явные номера той же пачки', async () => {
    const { service } = setup()
    // Наибольший номер в фонде — 120: явные 121 и 123 в соседней строке не повторяются.
    const ids = await service.createCopies('uni-1', [
      { bookId: 'book-1', inventoryNumbers: [], count: 3 },
      { bookId: 'book-2', inventoryNumbers: ['121', '123'], count: 0 },
    ])
    expect(ids).toEqual(['copy-122', 'copy-124', 'copy-125', 'copy-121', 'copy-123'])
  })

  it('повтор номера в пачке и занятый номер — 409 с перечнем', async () => {
    const { service, tx } = setup()
    await expect(
      service.createCopies('uni-1', [{ bookId: 'b', inventoryNumbers: ['7', '7'], count: 0 }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    tx.bookCopy.findMany.mockResolvedValue([{ inventoryNumber: '9' }])
    await expect(
      service.createCopies('uni-1', [{ bookId: 'b', inventoryNumbers: ['9'], count: 0 }]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('9') })
  })
})

describe('Импорт фонда', () => {
  const csv = (text: string) => Buffer.from(text, 'utf8')

  it('узнаёт колонки по русским заголовкам и разделителю «;»', () => {
    const rows = parseLibraryImportFile(
      csv('Название;Авторы;Инвентарный номер;Год\nРусская литература;Иванов;101, 102;2020\n'),
      'fond.csv',
    )
    expect(rows).toEqual([
      expect.objectContaining({
        line: 2,
        title: 'Русская литература',
        inventory: '101, 102',
        year: '2020',
      }),
    ])
  })

  it('без колонки «Название» — понятная ошибка', () => {
    expect(() => parseLibraryImportFile(csv('Автор;Год\nИванов;2020\n'), 'fond.csv')).toThrow(
      /Название/,
    )
  })

  it('предпросмотр: ошибки, повторы и один экземпляр по умолчанию', async () => {
    const { service, prisma } = setup()
    prisma.bookCopy.findMany.mockResolvedValue([{ inventoryNumber: '500' }])
    const importer = new LibraryImportService(
      prisma as never,
      { record: jest.fn() } as never,
      service,
    )
    const raw = (over: Partial<Record<string, string | number>>) => ({
      line: 2,
      title: 'Книга',
      authors: '',
      isbn: '',
      publisher: '',
      year: '',
      section: '',
      inventory: '',
      count: '',
      ...over,
    })
    const preview = await importer.preview(librarian, [
      raw({ line: 2 }),
      raw({ line: 3, title: '' }),
      raw({ line: 4, inventory: '500' }),
      raw({ line: 5, isbn: '12-3' }),
      raw({ line: 6, inventory: '600, 601', count: '2' }),
      // Явный ноль без номеров запись превратила бы в один экземпляр — это ошибка строки.
      raw({ line: 7, count: '0' }),
    ])
    expect(preview.rows.map((r) => r.status)).toEqual([
      'READY',
      'ERROR',
      'DUPLICATE',
      'ERROR',
      'READY',
      'ERROR',
    ])
    expect(preview.rows[0]?.count).toBe(1)
    expect(preview.summary).toMatchObject({ ready: 2, duplicate: 1, error: 3, copies: 5 })
  })

  it('запись: книга ищется под строки файла, архивная возвращается в каталог, а не дублируется', async () => {
    const { service, tx } = setup()
    const importer = new LibraryImportService(
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      service,
    )
    tx.book.findMany.mockResolvedValue([
      { id: 'book-old', title: 'Книга', authors: 'Иванов', isbn: null, archivedAt: new Date() },
    ])
    const row = {
      line: 2,
      title: 'КНИГА',
      authors: 'иванов',
      isbn: null,
      publisher: null,
      year: null,
      section: null,
      inventoryNumbers: [],
      count: 1,
    }
    const result = await importer.commit(librarian, { rows: [row] }, ctx)
    expect(result).toMatchObject({ books: 0, matched: 1 })
    expect(tx.book.create).not.toHaveBeenCalled()
    expect(tx.book.update).toHaveBeenCalledWith({
      where: { id: 'book-old' },
      data: { archivedAt: null },
    })
    // Кандидаты — по названиям и ISBN файла, без среза «первых N» карточек вуза.
    expect(tx.book.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-1',
      OR: [{ isbn: { in: [] } }, { title: { in: ['КНИГА'], mode: 'insensitive' } }],
    })
  })
})
