import { InviteStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
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
  const group = { findMany: jest.fn().mockResolvedValue([{ id: 'grp-1', name: 'BT-101' }]) }
  const user = { findMany: jest.fn().mockResolvedValue([]) }
  const invite = { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() }
  const prisma = {
    group,
    user,
    invite,
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as () => unknown)(),
    ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') }
  const service = new InviteService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, group, user, invite, audit }
}

describe('parseBulkInviteFile', () => {
  it('CSV: заголовки ru/en, запятая-разделитель, кавычки', () => {
    const csv = 'email,group,role\r\nstud@x.kz,BT-101,STUDENT\r\n"a@b.kz","BT-101",\r\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ line: 2, email: 'stud@x.kz', group: 'BT-101', role: 'STUDENT' })
    expect(rows[1]).toEqual({ line: 3, email: 'a@b.kz', group: 'BT-101', role: '' })
  })

  it('CSV: авто-детект разделителя «;» и русских заголовков', () => {
    const csv = 'почта;группа\nстуд@x.kz;BT-101\n'
    const rows = parseBulkInviteFile(Buffer.from(csv), 'list.csv')
    expect(rows[0]).toMatchObject({ email: 'студ@x.kz', group: 'BT-101' })
  })

  it('без обязательных колонок → BAD_REQUEST', () => {
    expect(() => parseBulkInviteFile(Buffer.from('name,age\nx,1\n'), 'x.csv')).toThrow()
  })

  it('неподдерживаемое расширение → ошибка', () => {
    expect(() => parseBulkInviteFile(Buffer.from('x'), 'file.pdf')).toThrow()
  })
})

describe('InviteService.bulkPreview', () => {
  it('валидная строка → READY с разрешённым groupId', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'new@x.kz', group: 'BT-101', role: 'STUDENT' },
    ])
    expect(res.summary).toEqual({ total: 1, ready: 1, duplicate: 0, error: 0 })
    expect(res.rows[0]).toMatchObject({ status: 'READY', groupId: 'grp-1' })
  })

  it('несуществующая группа → ERROR', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'new@x.kz', group: 'NO-SUCH', role: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'ERROR' })
    expect(res.summary.error).toBe(1)
  })

  it('битый email → ERROR', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'not-an-email', group: 'BT-101', role: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'ERROR' })
  })

  it('уже приглашённый email → DUPLICATE', async () => {
    const { service, invite } = setup()
    invite.findMany.mockResolvedValue([{ email: 'dupe@x.kz' }])
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'dupe@x.kz', group: 'BT-101', role: '' },
    ])
    expect(res.rows[0]).toMatchObject({ status: 'DUPLICATE' })
  })

  it('повтор email внутри файла → второй DUPLICATE', async () => {
    const { service } = setup()
    const res = await service.bulkPreview(dean, [
      { line: 2, email: 'same@x.kz', group: 'BT-101', role: '' },
      { line: 3, email: 'same@x.kz', group: 'BT-101', role: '' },
    ])
    expect(res.rows[0]!.status).toBe('READY')
    expect(res.rows[1]!.status).toBe('DUPLICATE')
  })
})

describe('InviteService.bulkCreate', () => {
  it('создаёт READY-строки, пропускает дубли, пишет сводный аудит', async () => {
    const { service, invite, user, audit } = setup()
    user.findMany.mockResolvedValue([{ email: 'exists@x.kz' }]) // этот пропустим
    invite.create.mockResolvedValue({ id: 'inv-1' })

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
    expect(invite.create).toHaveBeenCalledTimes(1)
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

// InviteStatus импортируется для согласованности с рантаймом (PENDING фильтр в loadTakenEmails).
void InviteStatus
