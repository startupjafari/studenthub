import * as XLSX from 'xlsx'
import { InviteStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { BULK_INVITE_MAX_ROWS } from '@studenthub/shared-schemas'
import { InviteService } from './invites.service'
import { parseBulkInviteFile } from './bulk-parse'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const dean: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-A',
  facultyId: 'fac-A',
  groupId: null,
}

function setup() {
  const group = {
    // Группа декана на его факультете: по facultyId подтверждение проверяет связность.
    findMany: jest.fn().mockResolvedValue([{ id: 'grp-1', name: 'BT-101', facultyId: 'fac-A' }]),
    // Связность scope (assertScopeExists): grp-1 лежит на факультете декана в его вузе.
    findUnique: jest
      .fn()
      .mockResolvedValue({ facultyId: 'fac-A', faculty: { universityId: 'uni-A' } }),
  }
  const faculty = {
    findMany: jest.fn().mockResolvedValue([{ id: 'fac-A', name: 'ИТ' }]),
    findUnique: jest.fn().mockResolvedValue({ universityId: 'uni-A' }),
  }
  const user = {
    findMany: jest.fn().mockResolvedValue([]),
    // Язык писем-приглашений — язык приглашающего (invites.service: issuerLocale).
    findUnique: jest.fn().mockResolvedValue({ locale: 'ru' }),
  }
  const invite = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  }
  const prisma: Record<string, unknown> = {
    group,
    faculty,
    user,
    invite,
    // advisory-лок подтверждения импорта (advisoryXactLock).
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  // Интерактивная транзакция получает в колбэк тот же мок — как клиент транзакции.
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') }
  const service = new InviteService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, group, faculty, user, invite, audit, queue }
}

/** Данные, переданные в createMany (одним вызовом на подтверждение). */
function createdRows(invite: { createMany: jest.Mock }): Record<string, unknown>[] {
  return invite.createMany.mock.calls.flatMap(
    (call) => (call[0] as { data: Record<string, unknown>[] }).data,
  )
}

describe('parseBulkInviteFile', () => {
  it('CSV: заголовки ru/en, запятая-разделитель, кавычки', () => {
    const csv = 'email,group,role\r\nstud@x.kz,BT-101,STUDENT\r\n"a@b.kz","BT-101",\r\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      line: 2,
      email: 'stud@x.kz',
      group: 'BT-101',
      role: 'STUDENT',
      faculty: '',
    })
    expect(rows[1]).toEqual({ line: 3, email: 'a@b.kz', group: 'BT-101', role: '', faculty: '' })
  })

  it('CSV: авто-детект разделителя «;» и русских заголовков', () => {
    const csv = 'почта;группа\nстуд@x.kz;BT-101\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows[0]).toMatchObject({ email: 'студ@x.kz', group: 'BT-101' })
  })

  it('колонка факультета читается, группа необязательна', () => {
    const csv = 'email,role,факультет\nteach@x.kz,DEAN,ИТ\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows[0]).toMatchObject({ email: 'teach@x.kz', role: 'DEAN', faculty: 'ИТ', group: '' })
  })

  it('без колонки email → BAD_REQUEST', () => {
    expect(() => parseBulkInviteFile(Buffer.from('name,age\nx,1\n'), 'x.csv')).toThrow()
  })

  it('неподдерживаемое расширение → ошибка', () => {
    expect(() => parseBulkInviteFile(Buffer.from('x'), 'file.pdf')).toThrow()
  })

  // A-F20: лист разбирался целиком — миллион строк и ячейка в столбце XFD синхронно
  // разворачивались в event loop, а лимит строк проверялся уже после.
  it('XLSX: дальше потолка строк и пятидесятой колонки лист не читается', () => {
    const aoa: string[][] = [['email', 'group']]
    for (let i = 0; i < BULK_INVITE_MAX_ROWS * 3; i++) aoa.push([`s${i}@x.kz`, 'BT-101'])
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    sheet['XFD2'] = { t: 's', v: 'далеко справа' }
    sheet['!ref'] = `A1:XFD${aoa.length}`
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Список')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const rows = parseBulkInviteFile(buffer, 'list.xlsx')

    // Заголовок + вдвое больше лимита: больше 500 строк импорт всё равно отклонит.
    expect(rows).toHaveLength(BULK_INVITE_MAX_ROWS * 2)
    expect(rows[0]).toMatchObject({ email: 's0@x.kz', group: 'BT-101' })
  })

  it('номер строки — строка в файле: пустые строки выше его не сдвигают (BUG-196)', () => {
    const csv = 'email,group\n\nfirst@x.kz,BT-101\n,\n\nsecond@x.kz,BT-101\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows.map((r) => [r.line, r.email])).toEqual([
      [3, 'first@x.kz'],
      [6, 'second@x.kz'],
    ])
  })

  it('XLSX: пропуски и таблица не с первой строки — номера как в Excel', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['email'], [''], ['a@x.kz']], { origin: 'A3' })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Список')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const rows = parseBulkInviteFile(buffer, 'list.xlsx')

    // Заголовок в строке 3, пустая 4, данные в строке 5.
    expect(rows).toEqual([{ line: 5, email: 'a@x.kz', group: '', role: '', faculty: '' }])
  })

  it('CSV: дальше потолка колонок строка не разворачивается', () => {
    const csv = `email,group${','.repeat(100_000)}\nstud@x.kz,BT-101${',x'.repeat(100_000)}\n`
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows[0]).toMatchObject({ line: 2, email: 'stud@x.kz', group: 'BT-101' })
  })

  it('CSV: дальше потолка строк файл не разбирается', () => {
    const lines = ['email']
    for (let i = 0; i < BULK_INVITE_MAX_ROWS * 3; i++) lines.push(`s${i}@x.kz`)
    const rows = parseBulkInviteFile(Buffer.from(lines.join('\n')), 'list.csv')
    expect(rows).toHaveLength(BULK_INVITE_MAX_ROWS * 2)
  })
})

describe('InviteService.bulkPreview', () => {
  it('валидная строка → READY с разрешённым groupId', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'new@x.kz', group: 'BT-101', role: 'STUDENT', faculty: '' },
    ])
    expect(res.summary).toEqual({ total: 1, ready: 1, duplicate: 0, error: 0 })
    expect(res.rows[0]).toMatchObject({ status: 'READY', groupId: 'grp-1' })
  })

  it('несуществующая группа → ERROR', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'new@x.kz', group: 'NO-SUCH', role: '', faculty: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'ERROR' })
    expect(res.summary.error).toBe(1)
  })

  it('битый email → ERROR', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'not-an-email', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'ERROR' })
  })

  // Предпросмотр проверяет адрес той же схемой, что подтверждение: иначе строка «Готово»
  // в предпросмотре валила всю пачку на POST /invites/bulk.
  it('адрес, который не примет подтверждение, → ERROR уже в предпросмотре', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'ivan..petrov@uni.kz', group: 'BT-101', role: '', faculty: '' },
      { line: 3, email: 'иван@uni.kz', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(res.rows.map((r) => r.status)).toEqual(['ERROR', 'ERROR'])
  })

  it('уже приглашённый email → DUPLICATE', async () => {
    const { service, invite } = setup()
    invite.findMany.mockResolvedValue([{ email: 'dupe@x.kz' }])
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'dupe@x.kz', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'DUPLICATE' })
  })

  it('повтор email внутри файла → второй DUPLICATE', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'same@x.kz', group: 'BT-101', role: '', faculty: '' },
      { line: 3, email: 'same@x.kz', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(res.rows[0]!.status).toBe('READY')
    expect(res.rows[1]!.status).toBe('DUPLICATE')
  })
})

// A-F01: адреса, записанные до нормализации («Ivanov@Uni.kz»), — тоже дубли. Раньше точный
// поиск их не видел: второй инвайт, вторая учётка того же человека.
describe('InviteService — дубли email без учёта регистра', () => {
  // Точный поиск (без `mode`) старую запись не находит, запасной без учёта регистра — находит.
  const legacyOnly = (row: { email: string }) =>
    jest.fn((args: { where: { email: { mode?: string } } }) =>
      Promise.resolve(args.where.email.mode === 'insensitive' ? [row] : []),
    )

  it('предпросмотр: учётка «Ivanov@Uni.kz» занимает «IVANOV@uni.kz» из файла', async () => {
    const { service, user } = setup()
    user.findMany = legacyOnly({ email: 'Ivanov@Uni.kz' })
    const res = await service.bulkPreview(dean, [
      { line: 2, email: ' IVANOV@uni.kz ', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(res.rows[0]).toMatchObject({ email: 'ivanov@uni.kz', status: 'DUPLICATE' })
    // Сначала точный поиск по нормализованным адресам, затем — только ненайденные.
    expect(user.findMany.mock.calls[0]![0].where.email).toEqual({ in: ['ivanov@uni.kz'] })
    expect(user.findMany.mock.calls[1]![0].where.email).toEqual({
      in: ['ivanov@uni.kz'],
      mode: 'insensitive',
    })
  })

  it('подтверждение: ожидающий инвайт на старый адрес — строка пропускается', async () => {
    const { service, invite } = setup()
    invite.findMany = legacyOnly({ email: 'Petrov@Uni.kz' })
    const res = await service.bulkCreate(
      dean,
      { rows: [{ email: 'petrov@uni.kz', groupId: 'grp-1', role: Role.STUDENT }] },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 1, failed: 0 })
    expect(invite.createMany).not.toHaveBeenCalled()
  })

  it('всё нашлось точным поиском — запасной не нужен', async () => {
    const { service, user } = setup()
    user.findMany.mockResolvedValue([{ email: 'known@x.kz' }])
    await service.bulkPreview(dean, [
      { line: 2, email: 'known@x.kz', group: 'BT-101', role: '', faculty: '' },
    ])
    expect(user.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('InviteService.bulkCreate', () => {
  it('создаёт READY-строки, пропускает дубли, пишет сводный аудит', async () => {
    const { service, invite, user, audit, group } = setup()
    user.findMany.mockResolvedValue([{ email: 'exists@x.kz' }]) // этот пропустим

    const res = await service.bulkCreate(
      dean,
      {
        rows: [
          { email: 'new1@x.kz', groupId: 'grp-1', role: Role.STUDENT },
          { email: 'exists@x.kz', groupId: 'grp-1', role: Role.STUDENT },
        ],
      },
      ctx,
    )
    expect(res).toEqual({ created: 1, skipped: 1, failed: 0 })
    // Одна вставка на всё подтверждение, а не запрос на строку.
    expect(invite.createMany).toHaveBeenCalledTimes(1)
    expect(createdRows(invite)).toEqual([
      expect.objectContaining({ email: 'new1@x.kz', groupId: 'grp-1', facultyId: 'fac-A' }),
    ])
    // Связность — по загруженным группам, без запроса на строку.
    expect(group.findUnique).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite_bulk_created' }),
    )
  })

  it('строка с недопустимой для роли иерархией → failed', async () => {
    const { service } = setup()
    // DEAN не может пригласить UNIVERSITY_ADMIN → resolveInviteTarget бросит.
    const res = await service.bulkCreate(
      dean,
      { rows: [{ email: 'x@x.kz', groupId: 'grp-1', role: Role.UNIVERSITY_ADMIN }] },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 0, failed: 1 })
  })
})

describe('InviteService — импорт у админа вуза: преподаватели и деканы', () => {
  const admin: JwtPayload = {
    sub: 'ua-1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-A',
    facultyId: null,
    groupId: null,
  }

  it('преподаватель без группы → READY, декан с факультетом → READY', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(admin, [
      { line: 2, email: 't@x.kz', group: '', role: 'TEACHER', faculty: '' },
      { line: 3, email: 'd@x.kz', group: '', role: 'DEAN', faculty: 'ИТ' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'READY', groupId: null, facultyId: null })
    expect(res.rows[1]).toMatchObject({ status: 'READY', facultyId: 'fac-A' })
  })

  it('декан без факультета → ERROR, студента админ не приглашает → ERROR', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(admin, [
      { line: 2, email: 'd@x.kz', group: '', role: 'DEAN', faculty: '' },
      { line: 3, email: 's@x.kz', group: 'BT-101', role: 'STUDENT', faculty: '' },
    ])
    expect(res.rows.map((r) => r.status)).toEqual(['ERROR', 'ERROR'])
  })

  it('декан создаётся с факультетом из файла', async () => {
    const { service, invite } = setup()
    const res = await service.bulkCreate(
      admin,
      { rows: [{ email: 'd@x.kz', facultyId: 'fac-A', role: Role.DEAN }] },
      ctx,
    )
    expect(res).toEqual({ created: 1, skipped: 0, failed: 0 })
    expect(createdRows(invite)).toEqual([
      expect.objectContaining({ role: Role.DEAN, facultyId: 'fac-A', universityId: 'uni-A' }),
    ])
  })

  it('id группы или факультета вне scope создателя → failed (подмена в запросе)', async () => {
    const { service, invite } = setup()
    const res = await service.bulkCreate(
      dean,
      {
        rows: [
          { email: 'a@x.kz', groupId: 'grp-of-other-faculty', role: Role.STUDENT },
          { email: 'b@x.kz', facultyId: 'fac-other', role: Role.TEACHER },
        ],
      },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 0, failed: 2 })
    expect(invite.createMany).not.toHaveBeenCalled()
  })
})

describe('InviteService.bulkCreate — подмена группы в запросе', () => {
  it('группа чужого факультета из тела запроса → failed, инвайт не создаётся', async () => {
    const { service, invite } = setup()
    const res = await service.bulkCreate(
      dean,
      { rows: [{ email: 'a@x.kz', groupId: 'grp-of-B', role: Role.STUDENT }] },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 0, failed: 1 })
    expect(invite.createMany).not.toHaveBeenCalled()
  })

  it('староста: группа старосты оказалась на другом факультете → failed', async () => {
    const { service, group, invite } = setup()
    const starosta: JwtPayload = {
      sub: 'st-1',
      role: Role.STAROSTA,
      universityId: 'uni-A',
      facultyId: 'fac-A',
      groupId: 'grp-1',
    }
    group.findMany.mockResolvedValue([{ id: 'grp-1', name: 'BT-101', facultyId: 'fac-B' }])
    const res = await service.bulkCreate(
      starosta,
      { rows: [{ email: 'a@x.kz', role: Role.STUDENT }] },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 0, failed: 1 })
    expect(invite.createMany).not.toHaveBeenCalled()
  })
})

// A-F20: две вкладки с одним файлом создавали дубли — обе видели адреса свободными.
describe('InviteService.bulkCreate — повторная отправка того же файла', () => {
  it('занятые адреса перечитываются под локом создателя, в той же транзакции', async () => {
    const { service, prisma, invite } = setup()
    const order: string[] = []
    ;(prisma.$executeRaw as jest.Mock).mockImplementation(async () => {
      order.push('lock')
      return 1
    })
    invite.findMany.mockImplementation(async () => {
      order.push('taken')
      return []
    })
    invite.createMany.mockImplementation(async () => {
      order.push('insert')
      return { count: 1 }
    })
    await service.bulkCreate(
      dean,
      { rows: [{ email: 'a@x.kz', groupId: 'grp-1', role: Role.STUDENT }] },
      ctx,
    )
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function))
    // Лок — до проверки занятости, вставка — после.
    expect(order[0]).toBe('lock')
    expect(order.indexOf('taken')).toBeGreaterThan(0)
    expect(order[order.length - 1]).toBe('insert')
  })

  it('вторая отправка видит инвайты первой — строки пропущены, вставки нет', async () => {
    const { service, invite } = setup()
    // Первая отправка уже закоммитила инвайт: под локом он виден как PENDING.
    invite.findMany.mockResolvedValue([{ email: 'a@x.kz' }])
    const res = await service.bulkCreate(
      dean,
      { rows: [{ email: 'a@x.kz', groupId: 'grp-1', role: Role.STUDENT }] },
      ctx,
    )
    expect(res).toEqual({ created: 0, skipped: 1, failed: 0 })
    expect(invite.createMany).not.toHaveBeenCalled()
  })

  it('письма уходят по одному на созданный инвайт', async () => {
    const { service, queue } = setup()
    const rows = Array.from({ length: 45 }, (_, i) => ({
      email: `s${i}@x.kz`,
      groupId: 'grp-1',
      role: Role.STUDENT,
    }))
    const res = await service.bulkCreate(dean, { rows }, ctx)
    expect(res.created).toBe(45)
    expect(queue.enqueue).toHaveBeenCalledTimes(45)
  })
})

// InviteStatus импортируется для согласованности с рантаймом (PENDING фильтр в loadTakenEmails).
void InviteStatus
