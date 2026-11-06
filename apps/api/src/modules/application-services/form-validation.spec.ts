import { formDataError, pickFormFields, type FormFieldRule } from './form-validation'

function field(over: Partial<FormFieldRule> = {}): FormFieldRule {
  return {
    code: 'f',
    type: 'TEXT',
    required: false,
    options: null,
    validation: null,
    labelRu: 'Поле',
    ...over,
  }
}

describe('form-validation — анкета услуги (D-F15)', () => {
  it('pickFormFields оставляет только поля анкеты', () => {
    expect(pickFormFields([{ code: 'a' }, { code: 'b' }], { a: 1, c: 'x' })).toEqual({ a: 1 })
    expect(pickFormFields([{ code: 'a' }], null)).toEqual({})
    expect(pickFormFields([{ code: 'a' }], ['a'] as never)).toEqual({})
  })

  it('обязательное поле: пусто и пробелы — ошибка', () => {
    const f = field({ required: true })
    expect(formDataError([f], {})).toContain('Заполните поле')
    expect(formDataError([f], { f: '   ' })).toContain('Заполните поле')
    expect(formDataError([f], { f: 'ok' })).toBeNull()
  })

  // Клиенты кодируют по-разному: веб и iOS — строкой, Android — числом.
  it('NUMBER: число или числовая строка; иначе — ошибка', () => {
    const f = field({ type: 'NUMBER' })
    expect(formDataError([f], { f: 3 })).toBeNull()
    expect(formDataError([f], { f: '3,5' })).toBeNull()
    expect(formDataError([f], { f: 'три' })).toContain('Недопустимое значение')
    expect(formDataError([f], { f: true })).toContain('Недопустимое значение')
  })

  it('DATE: «ГГГГ-ММ-ДД» и ISO с временем (iOS); несуществующая дата — ошибка', () => {
    const f = field({ type: 'DATE' })
    expect(formDataError([f], { f: '2026-10-17' })).toBeNull()
    expect(formDataError([f], { f: '2026-10-17T00:00:00Z' })).toBeNull()
    expect(formDataError([f], { f: '2026-02-31' })).not.toBeNull()
    expect(formDataError([f], { f: 'завтра' })).not.toBeNull()
  })

  // Обязательный флажок проходил снятым: false — не «пусто», и сервер считал поле заполненным.
  it('обязательный CHECKBOX — только отмеченный; обязательный BOOLEAN принимает «нет»', () => {
    const checkbox = field({ type: 'CHECKBOX', required: true })
    expect(formDataError([checkbox], { f: false })).toContain('Заполните поле')
    expect(formDataError([checkbox], { f: 'false' })).toContain('Заполните поле')
    expect(formDataError([checkbox], { f: true })).toBeNull()
    expect(formDataError([checkbox], { f: 'true' })).toBeNull()

    const yesNo = field({ type: 'BOOLEAN', required: true })
    expect(formDataError([yesNo], { f: false })).toBeNull()
    expect(formDataError([yesNo], {})).toContain('Заполните поле')
  })

  it('BOOLEAN/CHECKBOX: флажок или "true"/"false"', () => {
    const f = field({ type: 'CHECKBOX' })
    expect(formDataError([f], { f: false })).toBeNull()
    expect(formDataError([f], { f: 'true' })).toBeNull()
    expect(formDataError([f], { f: 'да' })).not.toBeNull()
  })

  it('SELECT: значение только из вариантов', () => {
    const f = field({ type: 'SELECT', options: [{ value: 'a' }, { value: 'b' }] })
    expect(formDataError([f], { f: 'a' })).toBeNull()
    expect(formDataError([f], { f: 'z' })).not.toBeNull()
  })

  it('TEXT: объект вместо строки — ошибка', () => {
    expect(formDataError([field()], { f: { nested: true } })).not.toBeNull()
  })

  it('validation: длина, границы числа и даты, шаблон', () => {
    expect(formDataError([field({ validation: { minLength: 3 } })], { f: 'ab' })).not.toBeNull()
    expect(formDataError([field({ validation: { maxLength: 3 } })], { f: 'abcd' })).not.toBeNull()
    const num = field({ type: 'NUMBER', validation: { min: 1, max: 5 } })
    expect(formDataError([num], { f: 6 })).not.toBeNull()
    expect(formDataError([num], { f: '2' })).toBeNull()
    const date = field({ type: 'DATE', validation: { min: '2026-01-01' } })
    expect(formDataError([date], { f: '2025-12-31' })).not.toBeNull()
    const iin = field({ validation: { pattern: '^\\d{12}$' } })
    expect(formDataError([iin], { f: '123' })).not.toBeNull()
    expect(formDataError([iin], { f: '123456789012' })).toBeNull()
  })

  // Правила пишет сид или шаблон платформы: кривое правило не должно ронять подачу.
  it('кривые правила игнорируются', () => {
    expect(formDataError([field({ validation: { pattern: '(' } })], { f: 'x' })).toBeNull()
    expect(formDataError([field({ validation: { maxLength: 'десять' } })], { f: 'x' })).toBeNull()
    expect(formDataError([field({ validation: ['x'] })], { f: 'x' })).toBeNull()
  })
})
