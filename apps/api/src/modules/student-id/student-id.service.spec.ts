import { Role } from '@studenthub/shared-types'
import { StudentIdService } from './student-id.service'

// Та же причина, что в room-qr.service.spec.ts: рендер тянет qrcode через резолвер Jest,
// это ~1.5 с, и на CI-раннере (втрое медленнее) тест карты подходил к таймауту 5 с.
// Отрисовка картинки проверена в qr-image.spec.ts — здесь важно, что ссылка в QR верная.
jest.mock('../../common/qr/qr-image', () => ({
  renderQrDataUrl: jest.fn(() => 'data:image/svg+xml;base64,stub'),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderQrDataUrl } = require('../../common/qr/qr-image') as {
  renderQrDataUrl: jest.Mock
}
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
  specialty: 'Информационные системы',
  fundingType: 'GRANT',
  dormitory: 'Общежитие №3, комн. 214',
  birthDate: new Date('2005-04-17T00:00:00.000Z'),
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
    expect(card.qr).toMatch(/^data:image\/svg\+xml/)
    // В QR уходит страница верификации с токеном — это и есть смысл карты.
    expect(renderQrDataUrl).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:3000/verify-id?t='),
      expect.anything(),
    )
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

  it('преподавателю — без даты рождения, формы оплаты и общежития; декану — полностью', async () => {
    const { service, prisma } = setup()
    const card = await service.myCard(viewer('stu-1', 'uni-A'))
    prisma.user.findFirst.mockResolvedValue(student)
    const teacher = await service.verify(
      { ...viewer('t', 'uni-A'), role: Role.TEACHER },
      card.token,
    )
    expect(teacher).toMatchObject({ birthDate: null, fundingType: null, dormitory: null })
    expect(teacher.course).toBe(2)
    prisma.user.findFirst.mockResolvedValue(student)
    const dean = await service.verify({ ...viewer('d', 'uni-A'), role: Role.DEAN }, card.token)
    expect(dean.fundingType).toBe('GRANT')
    expect(dean.dormitory).toBe(student.dormitory)
  })

  it('дата рождения — «со слов студента»: помечена в selfDeclared, если она есть в ответе', async () => {
    const { service, prisma } = setup()
    const card = await service.myCard(viewer('stu-1', 'uni-A'))
    prisma.user.findFirst.mockResolvedValue(student)
    const dean = await service.verify({ ...viewer('d', 'uni-A'), role: Role.DEAN }, card.token)
    expect(dean.selfDeclared).toEqual(['birthDate'])
    // Общежитие ведёт вуз — пометки у него нет.
    expect(dean.selfDeclared).not.toContain('dormitory')
    prisma.user.findFirst.mockResolvedValue(student)
    const teacher = await service.verify(
      { ...viewer('t', 'uni-A'), role: Role.TEACHER },
      card.token,
    )
    // Преподавателю дату рождения не отдают — и помечать нечего.
    expect(teacher.selfDeclared).toEqual([])
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
