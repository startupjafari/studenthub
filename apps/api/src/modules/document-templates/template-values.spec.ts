import { DOCUMENT_TEMPLATE_VARIABLES } from '@studenthub/shared-config'
import {
  buildTemplateValues,
  missingVariables,
  withOptionalBlanks,
  type TemplateSources,
} from './template-values'

const sources = (patch: Partial<TemplateSources['student']> = {}): TemplateSources => ({
  student: {
    lastName: 'Нурланова',
    firstName: 'Айгерим',
    middleName: null,
    birthDate: new Date('2005-03-14T00:00:00Z'),
    studentCardNumber: '202312345',
    course: 3,
    specialty: 'Информационные системы',
    studyForm: 'FULL_TIME',
    educationLevel: 'Магистратура',
    fundingType: 'GRANT',
    enrollmentYear: 2023,
    graduationYear: 2027,
    position: null,
    groupName: 'ИС-23',
    facultyName: null,
    ...patch,
  },
  university: {
    name: 'Пример университета',
    shortName: null,
    city: 'Астана',
    address: null,
    contactPhone: null,
    contactEmail: null,
    website: null,
    timezone: 'Asia/Almaty',
  },
  issuer: { lastName: 'Примерова', firstName: 'Мария', middleName: null, position: 'Специалист' },
  locale: 'ru',
  // 23:30 UTC 5 ноября — в Алматы уже 6 ноября.
  now: new Date('2026-11-05T23:30:00Z'),
})

describe('buildTemplateValues', () => {
  it('даёт значение каждой переменной реестра — и только им', () => {
    const values = buildTemplateValues(sources())
    expect([...values.keys()].sort()).toEqual(DOCUMENT_TEMPLATE_VARIABLES.map((v) => v.key).sort())
  })

  it('собирает ФИО без отсутствующего отчества и форматирует даты', () => {
    const values = buildTemplateValues(sources())
    expect(values.get('student.fullName')).toBe('Нурланова Айгерим')
    expect(values.get('student.middleName')).toBeNull()
    expect(values.get('student.birthDate')).toBe('14.03.2005')
    expect(values.get('document.date')).toBe('06.11.2026')
    expect(values.get('document.year')).toBe('2026')
    expect(values.get('student.course')).toBe('3')
    expect(values.get('issuer.fullName')).toBe('Примерова Мария')
  })

  it('переводит коды на язык документа, готовые слова оставляет', () => {
    const ru = buildTemplateValues(sources())
    expect(ru.get('student.studyForm')).toBe('Очная')
    expect(ru.get('student.fundingType')).toBe('Грант')
    expect(ru.get('student.educationLevel')).toBe('Магистратура')
    const kk = buildTemplateValues({ ...sources(), locale: 'kk' })
    expect(kk.get('student.studyForm')).toBe('Күндізгі')
  })

  it('пустые и пробельные поля — null, а не пустая строка', () => {
    const values = buildTemplateValues(sources({ specialty: '   ' }))
    expect(values.get('student.specialty')).toBeNull()
    expect(values.get('student.faculty')).toBeNull()
  })
})

describe('политика пустых значений', () => {
  it('обязательное пустое поле — в списке недостающих, необязательное — нет', () => {
    const values = buildTemplateValues(sources())
    expect(
      missingVariables(['student.fullName', 'student.faculty', 'student.middleName'], values),
    ).toEqual(['student.faculty'])
  })

  it('необязательное пустое поле подставляется пустой строкой', () => {
    const values = withOptionalBlanks(['student.middleName'], buildTemplateValues(sources()))
    expect(values.get('student.middleName')).toBe('')
  })
})
