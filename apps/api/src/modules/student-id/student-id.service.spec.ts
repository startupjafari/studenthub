import { Role } from '@studenthub/shared-types'
import { StudentIdService } from './student-id.service'
import { CryptoService } from '../../common/security/crypto.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const config = {
  get: (k: string) =>
    k === 'TOTP_ENCRYPTION_KEY'
      ? 'x'.repeat(32)
      : k === 'CORS_ORIGIN'
        ? 'http://localhost:3000'
        : '',
} as unknown as ConfigService<EnvVars, true>

const student = {
  id: 'stu-1',
  firstName: 'Иван',
  lastName: 'Петров',
  middleName: null,
  avatarUrl: null,
  avatarThumbUrl: null,
  role: Role.STUDENT,
  studentCardNumber: '123',
  academicStatus: 'Обучающийся',
  educationLevel: 'Бакалавриат',
  studyForm: 'Очная',
  course: 2,
  enrollmentYear: 2023,
  graduationYear: 2027,
  universityId: 'uni-A',
  group: { name: 'BT-201' },
  faculty: { name: 'Институт информационных технологий' },
  university: { name: 'КазНУ', shortName: 'КазНУ' },
}

const viewer = (sub: string, universityId: string | null): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId,
  facultyId: null,
  groupId: null,
})

function setup() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(student), findFirst: jest.fn() },
  }
  const crypto = new CryptoService(config)
  const service = new StudentIdService(prisma as unknown as PrismaService, crypto, config)
  return { service, prisma, crypto }
}

describe('StudentIdService — непрозрачный токен', () => {
  it('токен в QR не содержит читаемого id пользователя (зашифрован)', async () => {
    const { service } = setup()
    const card = await service.myCard(viewer('stu-1', 'uni-A'))
    expect(card.token).not.toContain('stu-1')
    // base64-декод компонент шифртекста не должен раскрывать id.
    expect(Buffer.from(card.token, 'base64').toString('utf8')).not.toContain('stu-1')
    expect(card.qr).toMatch(/^data:image\/png/)
    expect(card.course).toBe(2)
  })

  it('round-trip: myCard → verify возвращает валидную карту с временем проверки', async () => {
    const { service, prisma } = setup()
    const card = await service.myCard(viewer('stu-1', 'uni-A'))
    prisma.user.findFirst.mockResolvedValue(student)
    const res = await service.verify(viewer('staff', 'uni-A'), card.token)
    expect(res.valid).toBe(true)
    expect(res.id).toBe('stu-1')
    expect(res.course).toBe(2)
    expect(typeof res.verifiedAt).toBe('string')
  })

  it('подделанный токен → UNAUTHORIZED', async () => {
    const { service } = setup()
    await expect(service.verify(viewer('staff', 'uni-A'), 'garbage')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('истёкший токен → BAD_REQUEST', async () => {
    const { service, crypto } = setup()
    const expired = crypto.encrypt(
      JSON.stringify({ typ: 'student-id', sub: 'stu-1', exp: Date.now() - 1000 }),
    )
    await expect(service.verify(viewer('staff', 'uni-A'), expired)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('студент другого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    const card = await service.myCard(viewer('stu-1', 'uni-A'))
    prisma.user.findFirst.mockResolvedValue(student) // uni-A
    await expect(service.verify(viewer('staff', 'uni-B'), card.token)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })
})
