import { createHash } from 'node:crypto'
import { AuthService } from './auth.service'
import { CryptoService } from '../../common/security/crypto.service'

// A-F30. Браузер восстанавливает несколько вкладок — и все разом меняют одну refresh-cookie.
// Раньше каждый обмен в окне грации выдавал свою ротацию и гасил преемника предыдущего: в
// cookie мог остаться отозванный токен, и следующий refresh (уже вне окна) рвал цепочку как
// кражу. Теперь обмены одной цепочки идут по очереди, и опоздавшие получают того же преемника.

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const GRACE_MS = 10_000

interface Row {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  revokedAt: Date | null
  expiresAt: Date
}

interface Where {
  id?: string
  familyId?: string
  revokedAt?: null
  expiresAt?: { gt: Date }
}

const STUDENT = {
  id: 'u1',
  role: 'STUDENT',
  isBlocked: false,
  universityId: null,
  facultyId: null,
  groupId: null,
  twoFactorEnabled: false,
  companyMembership: null,
}

function setup(opts: { redisDown?: boolean } = {}) {
  // Таблица refresh_tokens в памяти: ровно те операции, что делает AuthService.
  const rows = new Map<string, Row>()
  rows.set('rt-0', {
    id: 'rt-0',
    userId: 'u1',
    familyId: 'fam-1',
    tokenHash: sha256('good'),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  let seq = 0
  const matches = (row: Row, where: Where) =>
    (where.id === undefined || row.id === where.id) &&
    (where.familyId === undefined || row.familyId === where.familyId) &&
    (where.revokedAt === undefined || row.revokedAt === null) &&
    (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt)
  const live = () => [...rows.values()].filter((r) => r.revokedAt === null)

  const refreshToken = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id)
      return row ? { ...row } : null
    }),
    findFirst: jest.fn(async ({ where }: { where: Where }) => {
      const row = [...rows.values()].find((r) => matches(r, where))
      return row ? { ...row } : null
    }),
    count: jest.fn(
      async ({ where }: { where: Where }) =>
        [...rows.values()].filter((r) => matches(r, where)).length,
    ),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      let count = 0
      for (const row of rows.values()) {
        if (matches(row, where)) {
          Object.assign(row, data)
          count += 1
        }
      }
      return { count }
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.get(where.id)
      if (!row) throw new Error('P2025')
      Object.assign(row, data)
      return { ...row }
    }),
    create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'revokedAt'> }) => {
      seq += 1
      const id = `rt-${seq}`
      rows.set(id, { id, revokedAt: null, ...data })
      return { id }
    }),
  }
  const tx = { refreshToken, $executeRaw: jest.fn().mockResolvedValue(1) }
  // Транзакции одной цепочки выполняются по очереди — так их упорядочивает advisory-лок.
  let chain: Promise<unknown> = Promise.resolve()
  const prisma = {
    refreshToken,
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => {
      const run = chain.then(() => fn(tx))
      chain = run.catch(() => undefined)
      return run
    }),
  }

  const store = new Map<string, string>()
  const redis = {
    store,
    get: jest.fn(async (key: string) => {
      if (opts.redisDown) throw new Error('ECONNREFUSED')
      return store.get(key) ?? null
    }),
    set: jest.fn(async (key: string, value: string) => {
      if (opts.redisDown) throw new Error('ECONNREFUSED')
      store.set(key, value)
      return 'OK'
    }),
  }
  const audit = { record: jest.fn() }
  const users = { findByIdForAuth: jest.fn().mockResolvedValue(STUDENT) }
  const config = {
    get: jest.fn((k: string) =>
      k === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : k === 'REFRESH_REUSE_GRACE_MS' ? GRACE_MS : 0,
    ),
  }
  const crypto = new CryptoService({ get: () => 'k'.repeat(32) } as never)
  const service = new AuthService(
    prisma as never,
    { sign: jest.fn(() => 'access') } as never,
    config as never,
    audit as never,
    {} as never,
    users as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never,
    {} as never,
    { assertAllowed: jest.fn() } as never,
    {} as never,
    crypto,
  )
  return { service, rows, live, redis, audit, users, refreshToken }
}

describe('AuthService.refresh: параллельные обмены одной cookie (A-F30)', () => {
  it('пять вкладок разом получают одного и того же преемника', async () => {
    const { service, live, audit, refreshToken } = setup()

    const sessions = await Promise.all(
      Array.from({ length: 5 }, () => service.refresh('rt-0.good', {})),
    )

    const tokens = new Set(sessions.map((s) => s.refreshToken))
    expect(tokens.size).toBe(1)
    // Ротация одна, живой токен в цепочке — ровно один, и это тот, что ушёл в cookie.
    expect(refreshToken.create).toHaveBeenCalledTimes(1)
    expect(live().map((r) => r.id)).toEqual([sessions[0]!.refreshToken.split('.')[0]])
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refresh_reuse_detected' }),
    )
  })

  it('повтор в окне грации отдаёт действующего преемника, а не новую ротацию', async () => {
    const { service, refreshToken } = setup()

    const first = await service.refresh('rt-0.good', {})
    const retry = await service.refresh('rt-0.good', {})

    expect(retry.refreshToken).toBe(first.refreshToken)
    expect(retry.refreshExpiresAt).toEqual(first.refreshExpiresAt)
    expect(refreshToken.create).toHaveBeenCalledTimes(1)
    // Преемник рабочий: следующий обмен идёт с ним как обычно.
    await expect(service.refresh(first.refreshToken, {})).resolves.toMatchObject({
      accessToken: 'access',
    })
  })

  it('в Redis — только шифртекст: сырого секрета преемника там нет', async () => {
    const { service, redis } = setup()
    const session = await service.refresh('rt-0.good', {})
    const secret = session.refreshToken.split('.')[1]!
    const stored = [...redis.store.values()].join('\n')
    expect(stored).not.toContain(secret)
  })

  it('повтор после окна грации по-прежнему рвёт цепочку', async () => {
    const { service, rows, live, audit } = setup()
    const first = await service.refresh('rt-0.good', {})
    // Старый токен погашен давно — это уже не соседняя вкладка, а повтор украденного.
    rows.get('rt-0')!.revokedAt = new Date(Date.now() - GRACE_MS - 1_000)

    await expect(service.refresh('rt-0.good', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(live()).toHaveLength(0)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refresh_reuse_detected' }),
    )
    await expect(service.refresh(first.refreshToken, {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('Redis недоступен — повтор в окне получает новую ротацию, живой токен один', async () => {
    const { service, live, refreshToken } = setup({ redisDown: true })

    const first = await service.refresh('rt-0.good', {})
    const retry = await service.refresh('rt-0.good', {})

    expect(retry.refreshToken).not.toBe(first.refreshToken)
    expect(refreshToken.create).toHaveBeenCalledTimes(2)
    expect(live().map((r) => r.id)).toEqual([retry.refreshToken.split('.')[0]])
  })

  it('цепочку погасили, пока обмен ждал (выход), — сессия не воскресает', async () => {
    const { service, rows, live, users, refreshToken } = setup()
    // Выход на другой вкладке случился между проверками и транзакцией обмена.
    users.findByIdForAuth.mockImplementationOnce(async () => {
      for (const row of rows.values()) row.revokedAt ??= new Date()
      return STUDENT
    })

    await expect(service.refresh('rt-0.good', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(refreshToken.create).not.toHaveBeenCalled()
    expect(live()).toHaveLength(0)
  })
})
