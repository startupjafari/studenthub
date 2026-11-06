import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import request from 'supertest'
import type { Prisma } from '@prisma/client'
import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/common/prisma/prisma.service'
import { PasswordService } from '../../src/common/security/password.service'
import { QueueService } from '../../src/common/queue/queue.service'
import { CronLockService } from '../../src/common/redis/cron-lock.service'
import { throttlerStorageStub } from '../throttler-storage.stub'

// Общий стенд API e2e: приложение с тем же префиксом и плагинами, что в main.ts, без
// throttler'а, и фабрики пользователей с входом. Раньше каждый спек библиотеки повторял
// эти сорок строк у себя.

export const E2E_PASSWORD = 'Passw0rd!'

/** Задача, которую приложение поставило бы в очередь (уведомление, письмо). */
export interface CapturedJob {
  queue: string
  name: string
  payload: Record<string, unknown>
}

export interface E2eAppOptions {
  /** Зарегистрировать @fastify/multipart — нужен буферным загрузкам (`POST …/upload`). */
  multipart?: boolean
  /**
   * Подменить очередь записью задач в `jobs`: уведомления проверяются по ним, и прогон не
   * ставит задачи в общий dev-Redis, где их подобрал бы чужой воркер с чужой БД.
   */
  captureQueue?: boolean
  /**
   * Cron-задачи без Redis-лока: вызов `CleanupService.*` из теста идёт сразу, а не
   * пропускается, если лок с тем же именем держит работающий рядом dev-сервер.
   */
  bypassCronLocks?: boolean
}

export interface E2eApp {
  app: NestFastifyApplication
  prisma: PrismaService
  server: ReturnType<NestFastifyApplication['getHttpServer']>
  /** Задачи очереди (только с `captureQueue`). */
  jobs: CapturedJob[]
  /** Пользователь с паролем `E2E_PASSWORD`; хеш считается один раз на стенд. */
  createUser(data: Omit<Prisma.UserUncheckedCreateInput, 'passwordHash'>): Promise<string>
  /** Access-токен по почте и паролю `E2E_PASSWORD`. */
  login(email: string): Promise<string>
  close(): Promise<void>
}

export async function createE2eApp(opts: E2eAppOptions = {}): Promise<E2eApp> {
  const jobs: CapturedJob[] = []
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(ThrottlerStorage)
    .useValue(throttlerStorageStub)
  if (opts.captureQueue) {
    builder = builder.overrideProvider(QueueService).useValue({
      enqueue: async (queue: string, name: string, payload: Record<string, unknown>) => {
        jobs.push({ queue, name, payload })
        return true
      },
      counts: async () => [],
      lastFailedReason: async () => null,
    })
  }
  if (opts.bypassCronLocks) {
    builder = builder.overrideProvider(CronLockService).useValue({
      run: <T>(_name: string, _ttlMs: number, task: () => Promise<T>) => task(),
    })
  }
  const moduleRef = await builder.compile()

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  app.setGlobalPrefix('api/v1')
  await app.register(cookie)
  if (opts.multipart) await app.register(multipart, { limits: { files: 10 } })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const prisma = app.get(PrismaService)
  const passwords = app.get(PasswordService)
  const server = app.getHttpServer()
  let passwordHash: Promise<string> | null = null

  return {
    app,
    prisma,
    server,
    jobs,
    async createUser(data) {
      passwordHash ??= passwords.hash(E2E_PASSWORD)
      const u = await prisma.user.create({
        data: { ...data, passwordHash: await passwordHash },
        select: { id: true },
      })
      return u.id
    },
    async login(email) {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: E2E_PASSWORD })
        .expect(201)
      return res.body.data.accessToken as string
    },
    close: () => app.close(),
  }
}

export const bearer = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
})
