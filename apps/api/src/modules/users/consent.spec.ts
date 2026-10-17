import { LEGAL_VERSION } from '@studenthub/shared-schemas'
import { UserService } from './users.service'
import { AuthService } from '../auth/auth.service'
import { consentStateOf, type ConsentRecord } from './consent'

// A-F29. Согласие из регистрации перестаёт подходить, когда меняется редакция документов или
// когда дата рождения в профиле расходится с основанием (сам человек / представитель).

/** Дата рождения, дающая ровно `years` лет на сегодня: тест не протухает со временем. */
function bornYearsAgo(years: number): Date {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  d.setUTCDate(d.getUTCDate() - 1)
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`)
}

const current = (patch: Partial<ConsentRecord> = {}): ConsentRecord => ({
  consentAt: new Date('2026-10-01T00:00:00Z'),
  consentVersion: LEGAL_VERSION,
  consentByGuardian: false,
  birthDate: bornYearsAgo(20),
  ...patch,
})

describe('consentStateOf', () => {
  it('действующая редакция и совершеннолетний — повторное согласие не нужно', () => {
    expect(consentStateOf(current())).toMatchObject({ required: false, reason: null })
  })

  it('согласие на прежнюю редакцию — нужно принять новую', () => {
    expect(consentStateOf(current({ consentVersion: '2026-01-01' }))).toMatchObject({
      required: true,
      reason: 'VERSION',
      version: LEGAL_VERSION,
      acceptedVersion: '2026-01-01',
    })
  })

  it('в профиле поставили дату несовершеннолетнего — нужно согласие представителя', () => {
    expect(consentStateOf(current({ birthDate: bornYearsAgo(16) }))).toMatchObject({
      required: true,
      reason: 'AGE_BASIS',
      guardianRequired: true,
    })
  })

  it('согласие давал представитель, а человеку уже 18 — нужно его собственное', () => {
    expect(consentStateOf(current({ consentByGuardian: true }))).toMatchObject({
      required: true,
      reason: 'AGE_BASIS',
      guardianRequired: false,
    })
  })

  it('несовершеннолетний с согласием представителя — всё в порядке', () => {
    expect(
      consentStateOf(current({ consentByGuardian: true, birthDate: bornYearsAgo(16) })),
    ).toMatchObject({ required: false, guardianRequired: true })
  })

  it('учётка до появления согласия (NULL) этим механизмом не спрашивается', () => {
    expect(
      consentStateOf({
        consentAt: null,
        consentVersion: null,
        consentByGuardian: false,
        birthDate: null,
      }),
    ).toMatchObject({ required: false, reason: null, birthDateRequired: true })
  })
})

describe('UserService.acceptConsent', () => {
  function setup(record: ConsentRecord) {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(record),
        update: jest.fn(async ({ data }: { data: Partial<ConsentRecord> }) => ({
          ...record,
          ...data,
        })),
      },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const service = new UserService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
    )
    return { service, prisma, audit }
  }

  it('записывает действующую редакцию, дату и основание; пишет аудит', async () => {
    const { service, prisma, audit } = setup(current({ consentVersion: '2026-01-01' }))

    const state = await service.acceptConsent('u1', { consent: true }, { ip: '1.2.3.4' })

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          consentVersion: LEGAL_VERSION,
          consentByGuardian: false,
          consentAt: expect.any(Date),
        }),
      }),
    )
    expect(state.required).toBe(false)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_accepted', entityId: 'u1', ip: '1.2.3.4' }),
    )
  })

  it('несовершеннолетний без согласия представителя — 400, ничего не пишется', async () => {
    const { service, prisma } = setup(current({ birthDate: bornYearsAgo(16) }))

    await expect(service.acceptConsent('u1', { consent: true }, {})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('несовершеннолетний с согласием представителя — основание «представитель»', async () => {
    const { service, prisma } = setup(current({ birthDate: bornYearsAgo(16) }))

    const state = await service.acceptConsent('u1', { consent: true, guardianConsent: true }, {})

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consentByGuardian: true }) }),
    )
    expect(state).toMatchObject({ required: false, byGuardian: true })
  })

  it('даты рождения нет — без неё согласие не принимается', async () => {
    const { service } = setup(current({ birthDate: null }))
    await expect(service.acceptConsent('u1', { consent: true }, {})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('даты рождения нет — форма согласия её дополняет', async () => {
    const { service, prisma } = setup(current({ birthDate: null }))

    await service.acceptConsent('u1', { consent: true, birthDate: '1990-05-17' }, {})

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ birthDate: new Date('1990-05-17T00:00:00Z') }),
      }),
    )
  })

  it('дату рождения форма согласия не меняет — её правят в профиле', async () => {
    const { service, prisma } = setup(current())
    await expect(
      service.acceptConsent('u1', { consent: true, birthDate: '2012-01-01' }, {}),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

describe('AuthService.getMe: флаг consentRequired', () => {
  it('профиль дополняется флагом из состояния согласия', async () => {
    const users = {
      findById: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.kz' }),
      consentState: jest.fn().mockResolvedValue(consentStateOf(current({ consentVersion: 'old' }))),
    }
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      users as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(service.getMe('u1')).resolves.toEqual({
      id: 'u1',
      email: 'a@b.kz',
      consentRequired: true,
    })
  })
})
