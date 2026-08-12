import { Role } from '@studenthub/shared-types'
import { ApplicationProcessService } from './application-process.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// $transaction поддерживает обе формы: колбэк (async tx => …) и массив промисов.
function makePrisma(appRow: Record<string, unknown>) {
  const application = {
    findFirst: jest.fn().mockResolvedValue(appRow),
    update: jest.fn().mockResolvedValue({ ...appRow }),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationEvent = { create: jest.fn().mockResolvedValue({}) }
  const applicationResult = { create: jest.fn().mockResolvedValue({}) }
  const tx = { application, applicationEvent, applicationResult }
  const prisma = {
    ...tx,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  }
  return prisma
}

const dean: JwtPayload = {
  sub: 'dean',
  role: Role.DEAN,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: null,
}

function setup(appRow: Record<string, unknown>) {
  const prisma = makePrisma(appRow)
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ApplicationProcessService(
    prisma as unknown as PrismaService,
    new ApplicationPolicy(),
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

const base = {
  id: 'a1',
  number: 'SH-1',
  studentId: 'stud',
  facultyId: 'fac',
  universityId: 'uni',
  deliveryType: 'ELECTRONIC',
  service: { nameRu: 'Справка' },
}

describe('ApplicationProcessService — state-machine + guards', () => {
  it('take из SUBMITTED → IN_REVIEW + назначение + уведомление НЕ шлётся (нет notify)', async () => {
    const { service, prisma } = setup({ ...base, status: 'SUBMITTED' })
    await service.take(dean, 'a1')
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_REVIEW', assignedToId: 'dean' }),
      }),
    )
  })

  it('take из IN_PREPARATION → BAD_REQUEST (нельзя взять из этого статуса)', async () => {
    const { service } = setup({ ...base, status: 'IN_PREPARATION' })
    await expect(service.take(dean, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('startPreparation из SUBMITTED → BAD_REQUEST (недопустимый переход)', async () => {
    const { service, prisma } = setup({ ...base, status: 'SUBMITTED' })
    await expect(service.startPreparation(dean, 'a1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.application.update).not.toHaveBeenCalled()
  })

  it('reject без причины → BAD_REQUEST', async () => {
    const { service } = setup({ ...base, status: 'IN_REVIEW' })
    await expect(service.reject(dean, 'a1', '')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('markReady для PAPER/BOTH → READY_FOR_PICKUP + pickupCode; уведомляет студента', async () => {
    const { service, prisma, queue } = setup({
      ...base,
      status: 'IN_PREPARATION',
      deliveryType: 'BOTH',
    })
    await service.markReady(dean, 'a1', { pickupLocation: 'каб. 312' })
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'READY_FOR_PICKUP',
          pickupCode: expect.stringContaining('SH-P-'),
        }),
      }),
    )
    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('markReady для ELECTRONIC → READY (без pickupCode)', async () => {
    const { service, prisma } = setup({
      ...base,
      status: 'IN_PREPARATION',
      deliveryType: 'ELECTRONIC',
    })
    await service.markReady(dean, 'a1', {})
    const call = prisma.application.update.mock.calls[0][0]
    expect(call.data.status).toBe('READY')
    expect(call.data.pickupCode).toBeUndefined()
  })

  it('issue из READY_FOR_PICKUP → ISSUED; из READY → BAD_REQUEST', async () => {
    const ok = setup({ ...base, status: 'READY_FOR_PICKUP' })
    await ok.service.issue(dean, 'a1')
    expect(ok.prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ISSUED', issuedById: 'dean' }),
      }),
    )
    const bad = setup({ ...base, status: 'READY' })
    await expect(bad.service.issue(dean, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('ApplicationProcessService — scope', () => {
  it('декан чужого факультета → FORBIDDEN', async () => {
    const { service } = setup({ ...base, status: 'SUBMITTED', facultyId: 'other' })
    await expect(service.take(dean, 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
