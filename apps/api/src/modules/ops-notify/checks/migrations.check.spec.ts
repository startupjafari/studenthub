import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaService } from '../../../common/prisma/prisma.service'
import type { OpsNotifier } from '../../../common/monitoring'
import { MigrationsCheck } from './migrations.check'

// T-3 (docs/TELEGRAM_BOT.md §8): «на БД с расхождением — список; на синхронной — тишина;
// старт не блокируется».

/** Настоящий каталог миграций во временной директории: mock’ать fs ради трёх имён незачем. */
function makeMigrationsDir(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ops-migrations-'))
  const dir = join(root, 'prisma', 'migrations')
  mkdirSync(dir, { recursive: true })
  for (const name of names) {
    mkdirSync(join(dir, name))
  }
  // Файл рядом с каталогами — не миграция, и в список попасть не должен.
  writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"')
  return root
}

function setup(local: string[], applied: string[] | Error) {
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const prisma = {
    $queryRaw: jest.fn(() =>
      applied instanceof Error
        ? Promise.reject(applied)
        : Promise.resolve(applied.map((migration_name) => ({ migration_name }))),
    ),
  }
  const check = new MigrationsCheck(prisma as unknown as PrismaService, ops)
  return { check, ops, cwd: makeMigrationsDir(local) }
}

describe('MigrationsCheck', () => {
  const originalCwd = process.cwd

  afterEach(() => {
    process.cwd = originalCwd
  })

  function runIn(cwd: string, check: MigrationsCheck) {
    process.cwd = () => cwd
    return check.run()
  }

  it('расхождение — список неприменённых в канал', async () => {
    const { check, ops, cwd } = setup(
      ['20260101000000_a', '20260102000000_b', '20260103000000_c'],
      ['20260101000000_a'],
    )

    const pending = await runIn(cwd, check)

    expect(pending).toEqual(['20260102000000_b', '20260103000000_c'])
    expect(ops.emit).toHaveBeenCalledWith('migrationsPending', {
      count: 2,
      names: '20260102000000_b, 20260103000000_c',
    })
  })

  it('синхронная БД — тишина', async () => {
    const { check, ops, cwd } = setup(['20260101000000_a'], ['20260101000000_a'])

    expect(await runIn(cwd, check)).toEqual([])
    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('длинный список сворачивается счётчиком — канал читают с телефона', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `2026010${i}000000_m${i}`)
    const { check, ops, cwd } = setup(names, [])

    await runIn(cwd, check)

    expect(ops.emit.mock.calls[0][1].count).toBe(8)
    expect(ops.emit.mock.calls[0][1].names).toContain('и ещё 3')
  })

  it('нет таблицы _prisma_migrations (db push у разработчика) — молчим', async () => {
    const { check, ops, cwd } = setup(['20260101000000_a'], new Error('relation does not exist'))

    expect(await runIn(cwd, check)).toEqual([])
    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('нет каталога миграций — молчим и не ходим в БД', async () => {
    const { check, ops } = setup([], [])
    process.cwd = () => tmpdir()

    expect(await check.run()).toEqual([])
    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('старт не блокируется: сбой проверки не всплывает из onApplicationBootstrap', async () => {
    const { check, cwd } = setup(['20260101000000_a'], new Error('БД недоступна'))
    process.cwd = () => cwd

    expect(() => check.onApplicationBootstrap()).not.toThrow()
  })
})
