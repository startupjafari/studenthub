import {
  TemplateNotRenderable,
  TemplateValueMissing,
  analyzeTemplate,
  demoTemplateValues,
  renderTemplate,
} from './docx-template-engine'
import { buildDocx, paragraph, partText, run, table } from './__testing__/docx-fixtures'

const values = (entries: Record<string, string | null>) => new Map(Object.entries(entries))

describe('analyzeTemplate — проверка переменных шаблона', () => {
  it('находит переменные в тексте, таблице и колонтитулах без повторов', () => {
    const docx = buildDocx({
      body:
        paragraph('Справка: {student.fullName}, курс {student.course}') +
        table([['Группа', '{student.group}']]) +
        paragraph('Ещё раз {student.fullName}'),
      header: '{university.name}',
      footer: 'Дата: {document.date}',
    })
    const result = analyzeTemplate(docx)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.variables.sort()).toEqual(
      [
        'document.date',
        'student.course',
        'student.fullName',
        'student.group',
        'university.name',
      ].sort(),
    )
  })

  it('собирает тег, разорванный Word на несколько фрагментов, и пробелы у скобок', () => {
    const docx = buildDocx({
      body:
        paragraph(run('{stu'), run('dent.fac', { bold: true }), run('ulty}')) +
        paragraph('{ student.group }'),
    })
    expect(analyzeTemplate(docx).variables).toEqual(['student.faculty', 'student.group'])
  })

  it('неизвестная переменная — ошибка UNKNOWN_VARIABLE', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('{student.unknownField}') }))
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      { code: 'UNKNOWN_VARIABLE', tag: 'student.unknownField', part: 'body' },
    ])
  })

  it('ИИН и прочие поля, которых нет в StudentHub, не поддерживаются', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('{student.iin} {university.bin}') }))
    expect(result.errors.map((e) => e.tag)).toEqual(['student.iin', 'university.bin'])
  })

  it('нарушенные скобки — SYNTAX', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('{student.fullName курс') }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.code).toBe('SYNTAX')
    const doubled = analyzeTemplate(buildDocx({ body: paragraph('{{student.group}}') }))
    expect(doubled.errors.every((e) => e.code === 'SYNTAX')).toBe(true)
  })

  it('циклы и условия в MVP не поддерживаются', () => {
    const result = analyzeTemplate(
      buildDocx({ body: paragraph('{#student.group}x{/student.group}') + paragraph('{^a}b{/a}') }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.every((e) => e.code === 'UNSUPPORTED_TAG')).toBe(true)
  })

  it('выражения не вычисляются — это просто неизвестный тег', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('{constructor.constructor}') }))
    expect(result.errors).toEqual([
      { code: 'UNKNOWN_VARIABLE', tag: 'constructor.constructor', part: 'body' },
    ])
  })

  it('документ без переменных годен, но с предупреждением', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('Просто текст') }))
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([{ code: 'NO_VARIABLES' }])
  })

  it('предупреждает о необязательных полях и персональных данных', () => {
    const result = analyzeTemplate(buildDocx({ body: paragraph('{student.middleName}') }))
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        { code: 'OPTIONAL_VARIABLE', tag: 'student.middleName' },
        { code: 'PERSONAL_DATA' },
      ]),
    )
  })
})

describe('renderTemplate — подстановка', () => {
  const template = buildDocx({
    body:
      paragraph(
        run('Настоящим подтверждается, что ', { font: 'Times New Roman' }),
        run('{student.fullName}', { font: 'Times New Roman', bold: true }),
        run(' является студентом {student.course} курса группы {student.group}.'),
      ) +
      table([
        ['Факультет', '{student.faculty}'],
        ['Форма обучения', '{student.studyForm}'],
      ]),
    header: '{university.name}',
    footer: 'Адрес: {university.address}',
  })
  const data = values({
    'student.fullName': 'Нурланова Айгерим Ержановна',
    'student.course': '3',
    'student.group': 'ИС-23',
    'student.faculty': 'Информационные <технологии> & связь',
    'student.studyForm': 'Очная',
    'university.name': 'Пример университета',
    'university.address': 'пр. Примерный, 1\nкорпус Б',
  })

  it('подставляет ФИО, курс и группу кириллицей', () => {
    const xml = partText(renderTemplate(template, data))
    expect(xml).toContain('Нурланова Айгерим Ержановна')
    expect(xml).toContain('является студентом 3 курса группы ИС-23.')
    expect(xml).not.toContain('{')
  })

  it('сохраняет оформление фрагмента и таблицу', () => {
    const xml = partText(renderTemplate(template, data))
    expect(xml).toContain(
      '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/></w:rPr><w:t xml:space="preserve">Нурланова Айгерим Ержановна</w:t>',
    )
    expect(xml).toContain('<w:tblStyle w:val="TableGrid"/>')
    expect(xml.match(/<w:tr>/g)).toHaveLength(2)
    expect(xml).toContain('Очная')
  })

  it('экранирует спецсимволы XML и переносит строки', () => {
    const out = renderTemplate(template, data)
    expect(partText(out)).toContain('Информационные &lt;технологии&gt; &amp; связь')
    expect(partText(out, 'word/footer1.xml')).toContain('<w:br/>')
    expect(partText(out, 'word/header1.xml')).toContain('Пример университета')
  })

  it('повторная генерация из того же исходника даёт тот же текст', () => {
    expect(partText(renderTemplate(template, data))).toBe(partText(renderTemplate(template, data)))
  })

  it('не формирует документ с пустым значением', () => {
    const empty = values({ ...Object.fromEntries(data), 'student.group': null })
    expect(() => renderTemplate(template, empty)).toThrow(TemplateValueMissing)
  })

  it('отказывается рендерить шаблон с неизвестной переменной', () => {
    const bad = buildDocx({ body: paragraph('{student.iin}') })
    expect(() => renderTemplate(bad, values({ 'student.iin': '000000000000' }))).toThrow(
      TemplateNotRenderable,
    )
  })

  it('проверочный документ заполняется демонстрационными значениями', () => {
    const xml = partText(renderTemplate(template, demoTemplateValues()))
    expect(xml).toContain('Нурланова Айгерим Ержановна')
    expect(xml).not.toContain('{')
  })
})
