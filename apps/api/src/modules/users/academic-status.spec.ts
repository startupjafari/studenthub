import {
  ACADEMIC_STATUSES,
  AcademicStatus,
  BLOCKED_ACADEMIC_STATUSES,
  LEFT_ACADEMIC_STATUS_CODES,
  NON_BLOCKING_ACADEMIC_STATUSES,
  STUDYING_ACADEMIC_STATUS_CODES,
  academicStatusCode,
  leftAcademicStatusCode,
  type AcademicStatusCode,
} from '@studenthub/shared-types'
import {
  canonicalAcademicStatus,
  isTerminalAcademicStatus,
  nextLeftUniversityAt,
} from './academic-status'

// Страж Фазы 21.C6: справочник учебных статусов один на api и веб, и каждый статус
// классифицирован ровно один раз — «учится» или «ушёл». Новый статус без решения, блокирует
// ли он выдачу, или статус сразу в обоих списках не проходит тесты.

const CODES = Object.keys(AcademicStatus) as AcademicStatusCode[]

describe('справочник учебных статусов (shared-types)', () => {
  it.each(CODES)('%s классифицирован ровно в один список', (code) => {
    const inStudying = (STUDYING_ACADEMIC_STATUS_CODES as readonly string[]).includes(code)
    const inLeft = (LEFT_ACADEMIC_STATUS_CODES as readonly string[]).includes(code)
    expect(Number(inStudying) + Number(inLeft)).toBe(1)
  })

  it('списки не содержат статусов вне справочника и вместе покрывают его', () => {
    const all = [...STUDYING_ACADEMIC_STATUS_CODES, ...LEFT_ACADEMIC_STATUS_CODES].sort()
    expect(all).toEqual([...CODES].sort())
    expect([...BLOCKED_ACADEMIC_STATUSES, ...NON_BLOCKING_ACADEMIC_STATUSES].sort()).toEqual(
      [...ACADEMIC_STATUSES].sort(),
    )
  })

  it('академический отпуск выдачу не блокирует', () => {
    expect(NON_BLOCKING_ACADEMIC_STATUSES).toContain(AcademicStatus.ACADEMIC_LEAVE)
    expect(BLOCKED_ACADEMIC_STATUSES).not.toContain(AcademicStatus.ACADEMIC_LEAVE)
    expect(isTerminalAcademicStatus('Академический отпуск')).toBe(false)
    expect(isTerminalAcademicStatus('ACADEMIC_LEAVE')).toBe(false)
  })

  it('отчислен, выпускник и переведён блокируют', () => {
    expect([...BLOCKED_ACADEMIC_STATUSES].sort()).toEqual(['Выпускник', 'Отчислен', 'Переведён'])
  })

  it('код распознаётся по написанию справочника и по коду сида', () => {
    expect(academicStatusCode('Отчислен')).toBe('EXPELLED')
    expect(academicStatusCode(' отчислен ')).toBe('EXPELLED')
    expect(academicStatusCode('EXPELLED')).toBe('EXPELLED')
    expect(academicStatusCode('переведен')).toBe('TRANSFERRED')
    expect(academicStatusCode('ACTIVE')).toBe('ACTIVE')
    expect(academicStatusCode('Отчислена')).toBeNull()
    expect(academicStatusCode('')).toBeNull()
    expect(academicStatusCode(null)).toBeNull()
  })

  it('leftAcademicStatusCode — код только у ушедших', () => {
    expect(leftAcademicStatusCode('Выпускник')).toBe('GRADUATED')
    expect(leftAcademicStatusCode('transferred')).toBe('TRANSFERRED')
    expect(leftAcademicStatusCode('Обучающийся')).toBeNull()
    expect(leftAcademicStatusCode(null)).toBeNull()
  })
})

describe('isTerminalAcademicStatus', () => {
  it.each([
    'Отчислен',
    'отчислен',
    'Выпускник',
    'Переведён',
    'Переведен',
    'EXPELLED',
    'graduated',
    'TRANSFERRED',
  ])('%s — ушёл', (status) => {
    expect(isTerminalAcademicStatus(status)).toBe(true)
  })

  it.each(['Обучающийся', 'ACTIVE', 'Обучается', '', null, undefined])('%s — учится', (status) => {
    expect(isTerminalAcademicStatus(status)).toBe(false)
  })

  it('каждый блокирующий статус справочника распознаётся как уход', () => {
    for (const status of BLOCKED_ACADEMIC_STATUSES) {
      expect(isTerminalAcademicStatus(status)).toBe(true)
      expect(nextLeftUniversityAt(status, null)).toBeInstanceOf(Date)
    }
    for (const status of NON_BLOCKING_ACADEMIC_STATUSES) {
      expect(isTerminalAcademicStatus(status)).toBe(false)
    }
  })
})

describe('canonicalAcademicStatus', () => {
  it('принимает только справочник — каждое значение в своём написании', () => {
    for (const status of ACADEMIC_STATUSES) {
      expect(canonicalAcademicStatus(status.toUpperCase())).toBe(status)
    }
    expect(canonicalAcademicStatus('EXPELLED')).toBeNull()
    expect(canonicalAcademicStatus('  ')).toBe('')
  })
})
