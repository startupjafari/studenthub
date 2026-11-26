// Шаг «сервисы: остальное»: мастер первичной настройки вуза, DOCX-шаблоны документов,
// журнал выгрузок (все виды и форматы, включая справки об обучении с отзывом), адресное
// открытие карьерного профиля компании, приглашения в команду компании и в вуз (отозванные,
// охрана, библиотека, админ вуза) — всё, что остальные шаги не создают. Последним — покрытие
// уведомлений и журнала аудита (76-coverage.mjs).
//
// Порядок прогона: после карьеры (шаг 80). Открытие профиля по правилам сервиса бывает
// только у студента, который откликался в эту компанию, а отклики создаёт шаг 80.
//
// ШАБЛОНЫ ДОКУМЕНТОВ И MINIO. Версия шаблона — это DOCX в приватном бакете `documents`:
// DocumentTemplateVersion.fileId → File (bucket + key), и предпросмотр, проверочная и
// настоящая генерация читают объект (FileService.getObjectBuffer). Версия без объекта —
// 500 на первой же генерации. Поэтому версии, публикация и журнал выдач создаются только
// с хранилищем (ctx.storage): маленький настоящий DOCX собирается в памяти и кладётся в
// бакет. Без хранилища остаётся карточка-черновик без файла — законное состояние «шаблон
// заведён, файл ещё не загружен», сервис на нём отвечает «Сначала загрузите файл».
//
// Секреты. Хэш токена приглашения и код проверки выгрузки (shortId печатается на справке,
// по нему страница /verify показывает документ) берутся из node:crypto, а не из
// ctx.random: сид гоняют и по общей базе, и выводимый из репозитория код означал бы
// готовую ссылку-приглашение в чужую компанию. Повторный прогон их не меняет: строка уже
// есть по детерминированному id, и createMany её пропускает.

import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

import { child, id } from '../lib/ids.mjs'
import {
  seedAuditCoverage,
  seedCompanyNotifications,
  seedNotificationCoverage,
} from './76-coverage.mjs'

// pizzip — зависимость apps/api (на ней работает шаблонизатор), как minio в lib/storage.mjs:
// корневой package.json ради сида не расширяем.
const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url))

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
// Фиксированная дата внутри архива: иначе байты (и checksum версии) менялись бы от прогона
// к прогону, а строка версии с прежней суммой осталась бы на месте.
const ZIP_DATE = new Date(Date.UTC(2026, 0, 1))
// Алфавит кода проверки — тот же, что readableCode в API: без 0/O и 1/I/L.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const HOUR = 3_600_000
const DAY = 24 * HOUR
// Срок приглашения (в компанию и в вуз) — TTL.INVITE_HOURS из shared-config.
const COMPANY_INVITE_TTL = 48 * HOUR

// Шаблоны вуза. `paragraphs` — текст документа с переменными реестра
// (DOCUMENT_TEMPLATE_VARIABLES); у опубликованных — только обязательные поля, которые у
// студентов сида заполнены (иначе генерация упала бы на TEMPLATE_DATA_MISSING), и
// необязательное отчество. Вместе шаблоны покрывают все категории
// (DOCUMENT_TEMPLATE_CATEGORY_VALUES), статусы, языки и виды замечаний проверки.
//
// `versions` — абзацы каждой версии по порядку. Версия с неизвестной переменной сохраняется
// с ошибкой (valid = false) — так API принимает файл, который ещё надо исправить; публикуется
// только исправная. `archive` — шаблон, по которому уже выдавали документы и который
// потом «удалили»: удаление выданного шаблона — архивация (DocumentTemplatesService.remove).
const STUDY_PARAGRAPHS = [
  '{university.name}',
  'СПРАВКА',
  'Выдана {student.fullName} в том, что он(а) действительно обучается на {student.course} курсе, группа {student.group}, {student.faculty}.', // prettier-ignore
  'Справка выдана для предъявления по месту требования.',
  'Дата выдачи: {document.date}',
  '{issuer.position} ____________ {issuer.fullName}',
]
const ORDER_PARAGRAPHS = [
  '{university.name}',
  'ВЫПИСКА ИЗ ПРИКАЗА',
  'Зачислить {student.fullName} на {student.course} курс, группа {student.group}, {student.faculty}.', // prettier-ignore
  'Дата: {document.date}',
  '{issuer.position} ____________ {issuer.fullName}',
]
const TEMPLATES = [
  {
    key: 'study',
    title: 'Справка с места учёбы',
    category: 'CERTIFICATE',
    description: 'Справка по месту требования: курс, группа, факультет.',
    versions: [STUDY_PARAGRAPHS, STUDY_PARAGRAPHS],
    publish: true,
  },
  {
    key: 'leave',
    title: 'Заявление на академический отпуск',
    category: 'APPLICATION',
    description: 'Бланк заявления; на публикацию ещё не отправлен.',
    versions: [
      [
        'Ректору {university.name}',
        'от студента группы {student.group} {student.faculty} {student.fullName}',
        'ЗАЯВЛЕНИЕ',
        'Прошу предоставить мне академический отпуск по состоянию здоровья.',
        'Дата: {document.date}',
      ],
    ],
    publish: false,
  },
  {
    key: 'dorm',
    title: 'Направление на заселение в общежитие',
    category: 'DORMITORY',
    description: 'Файл шаблона ещё не загружен.',
    versions: [],
    publish: false,
  },
  {
    // Первая версия загружена с опечаткой в переменной — проверка сохранила её с ошибкой
    // UNKNOWN_VARIABLE; опубликована исправленная вторая.
    key: 'order',
    title: 'Выписка из приказа о зачислении',
    category: 'ORDER',
    description: 'Выписка для студента: курс, группа и факультет по приказу.',
    versions: [ORDER_PARAGRAPHS.map((t) => t.replace('{student.group}', '{student.groupName}')), ORDER_PARAGRAPHS], // prettier-ignore
    publish: true,
  },
  {
    // Казахский бланк с отчеством: отчества у многих нет, проверка предупреждает
    // OPTIONAL_VARIABLE, но генерацию оно не останавливает.
    key: 'clearance',
    title: 'Айналма парағы',
    category: 'CLEARANCE',
    description: 'Обходной лист при отчислении или академическом отпуске (на казахском).',
    locale: 'kz',
    versions: [
      [
        '{university.name}',
        'АЙНАЛМА ПАРАҚ',
        'Білім алушы: {student.lastName} {student.firstName} {student.middleName}',
        'Тобы: {student.group}, {student.faculty}',
        'Кітапхана ____________  Жатақхана ____________  Бухгалтерия ____________',
        'Күні: {document.date}',
      ],
    ],
    publish: true,
  },
  {
    key: 'contract',
    title: 'Supplementary agreement to the study contract',
    category: 'CONTRACT',
    description: 'English-language agreement for exchange students; awaiting legal review.',
    locale: 'en',
    versions: [
      [
        '{university.name}',
        'SUPPLEMENTARY AGREEMENT',
        'The student {student.fullName}, group {student.group}, agrees to the updated terms of study.', // prettier-ignore
        'Date: {document.date}',
      ],
    ],
    publish: false,
  },
  {
    // Бланк без единой переменной — проверка предупреждает NO_VARIABLES.
    key: 'memo',
    title: 'Памятка первокурсника',
    category: 'OTHER',
    description: 'Статичный текст без подстановок: правила кампуса и полезные контакты.',
    versions: [
      [
        'ПАМЯТКА ПЕРВОКУРСНИКА',
        'Студенческий билет выдаётся в деканате в течение первой недели обучения.',
        'Пропуск в общежитие оформляется у коменданта.',
      ],
    ],
    publish: false,
  },
  {
    // Старая форма справки: по ней выдавали документы, потом шаблон «удалили» — значит,
    // архивировали (публикация снята, история и файлы остаются).
    key: 'study-old',
    title: 'Справка с места учёбы (форма 2025 года)',
    category: 'CERTIFICATE',
    description: 'Прежняя форма справки, заменена новой.',
    versions: [STUDY_PARAGRAPHS.slice(0, 4)],
    publish: true,
    archive: true,
  },
]
// Переменные реестра (DOCUMENT_TEMPLATE_VARIABLES в shared-config) из тех, что встречаются
// выше, с пометками реестра: personal — персональные данные, optional — может быть пустой.
const VARIABLE_REGISTRY = {
  'student.fullName': { personal: true },
  'student.lastName': { personal: true },
  'student.firstName': { personal: true },
  'student.middleName': { personal: true, optional: true },
  'student.group': {},
  'student.course': {},
  'student.faculty': {},
  'university.name': {},
  'document.date': {},
  'issuer.position': {},
  'issuer.fullName': {},
}

let warnedNoStorage = false

function readableCode(length) {
  let code = ''
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

// Хэш случайного токена — как у PENDING-инвайтов вуза в шаге 30: сам токен нигде не
// сохраняется, и ссылкой по такому приглашению не воспользоваться никому.
const randomTokenHash = () => createHash('sha256').update(randomUUID()).digest('hex')

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Минимальный настоящий DOCX: типы частей, связь на главную часть, текст абзацами. */
function buildDocx(paragraphs) {
  const PizZip = requireFromApi('pizzip')
  const zip = new PizZip()
  const opts = { date: ZIP_DATE }
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    opts,
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    opts,
  )
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}<w:sectPr/></w:body></w:document>`,
    opts,
  )
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Отчёт проверки — в той же форме, что пишет analyzeTemplate (docx-template-engine): переменные
 * реестра без повторов в порядке появления, неизвестные — ошибкой UNKNOWN_VARIABLE (версия
 * тогда невалидна), предупреждения NO_VARIABLES, OPTIONAL_VARIABLE и PERSONAL_DATA.
 */
function validationOf(paragraphs) {
  const variables = []
  const errors = []
  let tags = 0
  for (const text of paragraphs) {
    for (const [, key] of text.matchAll(/\{([^{}]+)\}/g)) {
      tags += 1
      if (!VARIABLE_REGISTRY[key]) {
        if (!errors.some((e) => e.tag === key)) errors.push({ code: 'UNKNOWN_VARIABLE', tag: key, part: 'body' }) // prettier-ignore
      } else if (!variables.includes(key)) {
        variables.push(key)
      }
    }
  }
  const warnings = []
  if (tags === 0) warnings.push({ code: 'NO_VARIABLES' })
  for (const key of variables) {
    if (VARIABLE_REGISTRY[key].optional) warnings.push({ code: 'OPTIONAL_VARIABLE', tag: key })
  }
  if (variables.some((key) => VARIABLE_REGISTRY[key].personal)) {
    warnings.push({ code: 'PERSONAL_DATA' })
  }
  return { valid: errors.length === 0, variables, errors, warnings }
}

async function objectExists(storage, bucket, key) {
  try {
    await storage.client.statObject(bucket, key)
    return true
  } catch {
    return false
  }
}

export async function seedServiceExtras(prisma, writer, ctx) {
  const { index, random, structure, people, companies, storage } = ctx
  const { uniId, profile } = structure
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))

  // ── Мастер первичной настройки ──────────────────────────────────────────────
  // Пройденность шагов по данным (факультеты, группы, аудитории — всё есть), в строке
  // только то, чего в данных нет. Запущенный вуз (ACTIVE, а BLOCKED — тоже бывший
  // рабочий) прошёл мастер до конца; PENDING — реквизиты подтверждены, запуска не было.
  // Статус — из базы: модератор платформы мог сменить его руками.
  const university = await prisma.university.findUnique({
    where: { id: uniId },
    select: { status: true },
  })
  const launched = university?.status !== 'PENDING'
  const onboardingStart = random.randomDate(-430, -420)
  await writer.add('universityOnboarding', {
    id: id(index, 'onboarding'),
    universityId: uniId,
    profileConfirmedAt: new Date(onboardingStart.getTime() + random.randInt(1, 48) * HOUR),
    // Пропущенные шаги (SKIPPABLE_ONBOARDING_STEPS) — по кругу от индекса вуза: их данные у
    // вуза сида заполнены позже, но отметка о пропуске в мастере остаётся.
    skippedSteps: [[], ['rooms'], ['specialties', 'subjects'], ['specialties', 'rooms', 'subjects']][index % 4], // prettier-ignore
    dismissedAt: !launched && random.chance(0.5) ? random.randomDate(-10, -1) : null,
    completedAt: launched ? new Date(onboardingStart.getTime() + random.randInt(3, 14) * DAY) : null, // prettier-ignore
    createdAt: onboardingStart,
  })

  // ── Шаблоны документов ─────────────────────────────────────────────────────
  const withFiles = Boolean(storage)
  if (!withFiles && !warnedNoStorage) {
    warnedNoStorage = true
    console.log(
      '  Шаблоны документов: без хранилища — только карточки-черновики без файла ' +
        '(версии, публикация и журнал выдач требуют DOCX в бакете documents).',
    )
  }
  const templates = TEMPLATES.filter((t) => withFiles || t.versions.length === 0)
  const templateDates = new Map()
  for (const template of templates) {
    const templateId = id(index, 'dtpl', template.key)
    const createdAt = random.randomDate(-200, -120)
    templateDates.set(template.key, createdAt)
    await writer.add('documentTemplate', {
      id: templateId,
      universityId: uniId,
      title: template.title,
      category: template.category,
      description: template.description,
      locale: template.locale ?? 'ru',
      // Публикация и указатели на версии — апдейтом ниже: версия ссылается на шаблон,
      // шаблон на версию. До апдейта шаблон — черновик, а не «опубликован без файла».
      status: 'DRAFT',
      createdById: people.adminId,
      createdAt,
    })
  }
  await writer.flush()

  if (withFiles) {
    const bucket = storage.buckets.documents
    const pointers = []
    const generationTargets = []
    for (const template of templates) {
      if (template.versions.length === 0) continue
      const templateId = id(index, 'dtpl', template.key)
      let at = templateDates.get(template.key)
      let lastVersionId = null
      let lastValid = false
      for (const [vi, paragraphs] of template.versions.entries()) {
        const v = vi + 1
        const buffer = buildDocx(paragraphs)
        const checksum = createHash('sha256').update(buffer).digest('hex')
        const validation = validationOf(paragraphs)
        at = new Date(at.getTime() + random.randInt(1, 20) * DAY)
        const versionId = child(templateId, 'v', v)
        const fileId = child(versionId, 'file')
        const key = `seed/document-templates/${versionId}.docx`
        if (!(await objectExists(storage, bucket, key))) {
          await storage.client.putObject(bucket, key, buffer, buffer.length, {
            'Content-Type': DOCX_MIME,
          })
        }
        // Объект без строки File ночная чистка удалила бы; строка без объекта роняла бы
        // генерацию. Поэтому и то и другое — рядом.
        await writer.add('file', {
          id: fileId,
          bucket,
          key,
          mime: DOCX_MIME,
          size: buffer.length,
          name: `${template.title}.docx`,
          ownerId: people.adminId,
          createdAt: at,
        })
        await writer.add('documentTemplateVersion', {
          id: versionId,
          templateId,
          version: v,
          fileId,
          fileName: `${template.title}.docx`,
          size: buffer.length,
          checksum,
          variables: validation.variables,
          validation,
          valid: validation.valid,
          createdById: people.adminId,
          createdAt: at,
        })
        lastVersionId = versionId
        lastValid = validation.valid
      }
      // Публикуется только исправная версия — как требует publish в сервисе.
      const publish = template.publish && lastValid
      const publishedAt = publish ? new Date(at.getTime() + random.randInt(1, 48) * HOUR) : null
      // Архив — через две-три недели после публикации: успели выдать, потом заменили.
      const archivedAt =
        publish && template.archive
          ? new Date(publishedAt.getTime() + random.randInt(14, 21) * DAY)
          : null
      pointers.push({ templateId, lastVersionId, publishedAt, archivedAt })
      if (publish) {
        generationTargets.push({ templateId, versionId: lastVersionId, publishedAt, until: archivedAt }) // prettier-ignore
      }
    }
    await writer.flush()

    for (const { templateId, lastVersionId, publishedAt, archivedAt } of pointers) {
      await prisma.documentTemplate.update({
        where: { id: templateId },
        data: {
          currentVersionId: lastVersionId,
          ...(archivedAt
            ? // Архивация снимает публикацию (DocumentTemplatesService.archive).
              { status: 'ARCHIVED', archivedAt }
            : publishedAt
              ? {
                  status: 'PUBLISHED',
                  publishedVersionId: lastVersionId,
                  publishedAt,
                  publishedById: people.adminId,
                }
              : {}),
        },
      })
    }

    // Журнал выдач: только по опубликованной версии, только студентам своего вуза и только
    // пока шаблон был опубликован (у архивного — до архивации).
    for (const { templateId, versionId, publishedAt, until } of generationTargets) {
      const end = until ? until.getTime() : Date.now()
      const span = Math.max(1, end - publishedAt.getTime())
      for (const [gi, studentId] of random.sample(allStudents, random.randInt(3, 8)).entries()) {
        const faculty = people.faculties.find((f) => f.groups.some((g) => g.studentIds.includes(studentId))) // prettier-ignore
        await writer.add('documentTemplateGeneration', {
          id: child(templateId, 'gen', gi),
          templateId,
          versionId,
          universityId: uniId,
          studentId,
          // Формирует админ вуза или декан факультета студента.
          actorId: random.chance(0.6) ? people.adminId : faculty.deanId,
          createdAt: new Date(publishedAt.getTime() + Math.floor(random.rng() * span)),
        })
      }
    }
    await writer.flush()
  }

  // ── Журнал выгрузок ─────────────────────────────────────────────────────────
  // Строка — то, что пишет ExportRegistryService: кто, вид, формат, условия выборки
  // строками (cleanParams), число строк. IP и браузер не выдумываем — null.
  const exportRow = (kind, n, row) =>
    writer.add('documentExport', {
      id: id(index, 'exp', kind, n),
      shortId: readableCode(8),
      ip: null,
      userAgent: null,
      ...row,
      kind,
    })

  // Справки «задолженностей в библиотеке нет»: только читателям без долга — открытой
  // выдачи или непогашенной утери (UNSETTLED_DEBT_WHERE), иначе сервис справку не выдал бы.
  const clearanceCandidates = random.sample(allStudents, Math.min(30, Math.ceil(allStudents.length * 0.05))) // prettier-ignore
  if (clearanceCandidates.length > 0) {
    const debtors = await prisma.loan.findMany({
      where: {
        universityId: uniId,
        readerId: { in: clearanceCandidates },
        OR: [{ status: 'OPEN' }, { status: 'LOST', lostSettledAt: null }],
      },
      select: { readerId: true },
      take: 5000,
    })
    const indebted = new Set(debtors.map((d) => d.readerId))
    const readers = clearanceCandidates.filter((s) => !indebted.has(s))
    const names = await prisma.user.findMany({
      where: { id: { in: readers } },
      select: { id: true, firstName: true, lastName: true, middleName: true },
      take: readers.length,
    })
    const nameOf = new Map(
      names.map((u) => [u.id, [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ')]),
    )
    for (const [n, readerId] of readers.entries()) {
      if (!nameOf.has(readerId)) continue
      const createdAt = random.randomDate(-90, -1)
      await exportRow('library-clearance', n, {
        // Справку берёт себе сам студент: он и есть «кто выгрузил».
        userId: readerId,
        format: 'pdf',
        params: { universityId: uniId, readerId },
        rows: null,
        subjectName: nameOf.get(readerId),
        documentNumber: `LIB-${createdAt.getUTCFullYear()}-${readableCode(6)}`,
        issuerName: profile.name,
        createdAt,
        // Отозвана библиотекарем: бумага у человека, но проверка покажет «отозван».
        revokedAt: random.chance(0.1) ? new Date(createdAt.getTime() + random.randInt(1, 20) * DAY) : null, // prettier-ignore
      })
    }
  }

  // Резюме в PDF — у части студентов (резюме есть у всех, шаг 80).
  const resumeAuthors = random.sample(
    allStudents,
    Math.min(60, Math.ceil(allStudents.length * 0.1)),
  )
  for (const [n, userId] of resumeAuthors.entries()) {
    await exportRow('resume', n, {
      userId,
      format: 'pdf',
      rows: null,
      createdAt: random.randomDate(-60, 0),
    })
  }

  // Список пользователей у админа вуза — по факультетам, с фильтром по роли.
  for (const [n, faculty] of people.faculties.entries()) {
    if (n >= 3) break
    await exportRow('users', n, {
      userId: people.adminId,
      // Форматы по кругу: на любом вузе встречаются оба (ExportFormat у списков — xlsx|csv).
      format: n % 2 === 0 ? 'xlsx' : 'csv',
      params: { role: 'STUDENT', facultyId: faculty.id },
      rows: faculty.groups.reduce((sum, g) => sum + g.studentIds.length, 0),
      createdAt: random.randomDate(-120, -1),
    })
  }

  // Отчёты: карьерный — у админа вуза, аналитический — у админа по вузу и у деканов по
  // факультету. Периоды и форматы — по кругу (CAREER_REPORT_PERIODS, ANALYTICS_REPORT_*).
  // Границы — как у resolveRange: месяц — 30 дней, квартал — 90, год — учебный, с 1 сентября.
  const PERIODS = ['month', 'quarter', 'year']
  const period = (createdAt, n) => {
    const name = PERIODS[n % PERIODS.length]
    const september = Date.UTC(createdAt.getUTCFullYear() - (createdAt.getUTCMonth() < 8 ? 1 : 0), 8, 1) // prettier-ignore
    const from =
      name === 'year'
        ? new Date(september)
        : new Date(createdAt.getTime() - (name === 'month' ? 30 : 90) * DAY)
    return { period: name, from: from.toISOString(), to: createdAt.toISOString() }
  }
  for (let n = 0; n < 3; n += 1) {
    const createdAt = random.randomDate(-90, -1)
    await exportRow('career-report', n, {
      userId: people.adminId,
      format: n % 2 === 0 ? 'xlsx' : 'csv',
      params: { ...period(createdAt, n), universityId: uniId },
      rows: random.randInt(8, 40),
      createdAt,
    })
  }
  const analyticsActors = [
    [people.adminId, 'university', uniId],
    ...people.faculties.map((f) => [f.deanId, 'faculty', f.id]),
  ]
  for (const [n, [userId, level, scopeId]] of analyticsActors.entries()) {
    const createdAt = random.randomDate(-90, -1)
    const { period: name, from, to } = period(createdAt, n)
    await exportRow('analytics-report', n, {
      userId,
      format: n % 2 === 0 ? 'xlsx' : 'csv',
      params: { level, scopeId, period: name, from, to },
      rows: random.randInt(5, 60),
      createdAt,
    })
  }

  // Справки об обучении (issueStudyCertificate): официальный документ с кодом проверки —
  // реквизиты снимком на момент выдачи, номер справки = номер заявки. Строка на каждую
  // электронную справку шага 70; отозванная там справка (документ REJECTED) отозвана и
  // здесь — страница /verify покажет «отозван».
  const certificates = await prisma.applicationResult.findMany({
    where: {
      application: { universityId: uniId },
      document: { is: { type: 'STUDY_PLACE_REF', issuedByUniversity: true } },
    },
    select: {
      applicationId: true,
      issuedById: true,
      createdAt: true,
      application: {
        select: { number: true, student: { select: { firstName: true, lastName: true, middleName: true } } }, // prettier-ignore
      },
      document: { select: { status: true } },
    },
    orderBy: { id: 'asc' },
    take: 1000,
  })
  for (const [n, cert] of certificates.entries()) {
    const number = cert.application.number
    if (!number) continue
    const student = cert.application.student
    await exportRow('certificate', n, {
      userId: cert.issuedById,
      format: 'pdf',
      params: { applicationId: cert.applicationId, number },
      rows: null,
      subjectName: [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' '), // prettier-ignore
      documentNumber: number,
      issuerName: profile.name,
      createdAt: cert.createdAt,
      revokedAt: cert.document?.status === 'REJECTED' ? new Date(cert.createdAt.getTime() + 2 * DAY) : null, // prettier-ignore
    })
  }

  // Выгрузка переписки (txt и json) и «мои данные» (json): форматы ExportFormat, которых у
  // остальных выгрузок нет. Параметров у чата нет; у «моих данных» — число разделов.
  for (const [n, userId] of allStudents.slice(0, 4).entries()) {
    await exportRow('chat', n, {
      userId,
      format: n % 2 === 0 ? 'txt' : 'json',
      rows: random.randInt(40, 900),
      createdAt: random.randomDate(-60, -1),
    })
  }
  for (const [n, userId] of allStudents.slice(4, 6).entries()) {
    await exportRow('my-data', n, {
      userId,
      format: 'json',
      params: { sections: '14' },
      rows: random.randInt(300, 2500),
      createdAt: random.randomDate(-90, -1),
    })
  }
  await writer.flush()

  // ── Открытие карьерного профиля компании ───────────────────────────────────
  // Сервис открывает профиль только компании, в которую студент откликался
  // (shareWithCompany проверяет отклик). Одна строка на пару «студент ↔ компания»;
  // закрытие — revokedAt, а не удаление.
  const applications = await prisma.careerApplication.findMany({
    where: { universityId: uniId },
    select: { studentId: true, companyId: true },
    orderBy: { id: 'asc' },
    take: 5000,
  })
  const pairs = new Map()
  for (const a of applications) pairs.set(`${a.studentId}|${a.companyId}`, a)
  for (const { studentId, companyId } of pairs.values()) {
    if (!random.chance(0.25)) continue
    const grantedAt = random.randomDate(-45, -1)
    await writer.add('careerProfileGrant', {
      id: child(studentId, 'grant', companyId),
      userId: studentId,
      companyId,
      grantedAt,
      revokedAt: random.chance(0.2) ? new Date(grantedAt.getTime() + random.randInt(1, 10) * DAY) : null, // prettier-ignore
      createdAt: grantedAt,
    })
  }

  // ── Приглашения в команду компании ─────────────────────────────────────────
  // Компания — сущность платформы, а не вуза, поэтому каждый вуз берёт на себя одну
  // компанию по своему индексу: id приглашений от вуза не зависят, и повторная встреча
  // той же компании (вузов больше, чем компаний) ничего не дублирует. Приглашает только
  // OWNER (recruiterIds[0]) и только у ACTIVE-компании — как требует сервис.
  // Берётся первая ACTIVE начиная с этого смещения: компания с индексом 0 всегда ждёт
  // подтверждения почты (15-companies.mjs), и вуз u001 остался бы без приглашений.
  const company = companies?.length
    ? (Array.from(
        { length: companies.length },
        (_, k) => companies[(index - 1 + k) % companies.length],
      ).find((c) => c.status === 'ACTIVE' && c.recruiterIds?.length) ?? null)
    : null
  if (company) {
    const ownerId = company.recruiterIds[0]
    const now = Date.now()
    const invites = []
    // Принятое: второй сотрудник компании (RECRUITER из шага 15) пришёл по приглашению,
    // адрес совпадает с его аккаунтом — так регистрация по ссылке и работает.
    if (company.recruiterIds[1]) {
      const createdAt = random.randomDate(-90, -30)
      invites.push({
        email: `hr1@${company.slug}.example.kz`,
        status: 'ACCEPTED',
        createdAt,
        expiresAt: new Date(createdAt.getTime() + COMPANY_INVITE_TTL),
        acceptedById: company.recruiterIds[1],
        acceptedAt: new Date(createdAt.getTime() + random.randInt(1, 40) * HOUR),
      })
    }
    // Ожидающее и ещё действующее.
    const pendingExpires = new Date(now + random.randInt(6, 40) * HOUR)
    invites.push({
      email: `recruiter.new@${company.slug}.example.kz`,
      status: 'PENDING',
      createdAt: new Date(pendingExpires.getTime() - COMPANY_INVITE_TTL),
      expiresAt: pendingExpires,
    })
    // Ожидающее, но просроченное: истечение не хранится статусом, его видно по expiresAt.
    const staleCreated = random.randomDate(-40, -10)
    invites.push({
      email: `intern.hr@${company.slug}.example.kz`,
      status: 'PENDING',
      createdAt: staleCreated,
      expiresAt: new Date(staleCreated.getTime() + COMPANY_INVITE_TTL),
    })
    // Отозванное владельцем до истечения.
    const revokedCreated = random.randomDate(-60, -20)
    invites.push({
      email: `old.contact@${company.slug}.example.kz`,
      status: 'REVOKED',
      createdAt: revokedCreated,
      expiresAt: new Date(revokedCreated.getTime() + COMPANY_INVITE_TTL),
      revokedAt: new Date(revokedCreated.getTime() + random.randInt(1, 30) * HOUR),
    })
    for (const [n, invite] of invites.entries()) {
      await writer.add('companyInvite', {
        id: `${company.id}-cinv-${n}`,
        companyId: company.id,
        role: 'RECRUITER',
        tokenHash: randomTokenHash(),
        invitedById: ownerId,
        acceptedById: null,
        acceptedAt: null,
        revokedAt: null,
        ...invite,
        updatedAt: invite.acceptedAt ?? invite.revokedAt ?? invite.createdAt,
      })
    }
    // Уведомления стороны компании: решения вузов по допуску и вакансиям, новые отклики.
    const vacancy = await prisma.vacancy.findFirst({
      where: { companyId: company.id },
      select: { title: true },
      orderBy: { id: 'asc' },
    })
    await seedCompanyNotifications(writer, {
      company,
      universityName: profile.name,
      vacancyTitle: vacancy?.title ?? 'Стажёр',
    })
  }

  // ── Приглашения вуза: отозванные и роли, которых нет в шаге 30 ─────────────
  // Шаг 30 даёт PENDING/USED/EXPIRED; здесь — REVOKED и приглашения на охрану, библиотеку и
  // самого админа вуза (его приглашает платформа). Выдающий — по иерархии ALLOWED_ISSUERS
  // (invite-hierarchy.ts): студента зовёт староста, преподавателя и старосту — декан,
  // охрану и библиотекаря — админ вуза. Живой (PENDING) токен — хэш случайного, как в шаге 30.
  const platformAdmin = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const faculty0 = people.faculties[0]
  const group0 = faculty0.groups[0]
  const extraInvites = [
    ['STUDENT', 'PENDING', group0.starostaId, { facultyId: faculty0.id, groupId: group0.id }],
    ['STAROSTA', 'EXPIRED', faculty0.deanId, { facultyId: faculty0.id, groupId: group0.id }],
    ['TEACHER', 'REVOKED', faculty0.deanId, { facultyId: faculty0.id }],
    ['SECURITY_GUARD', 'PENDING', people.adminId, {}],
    ['LIBRARIAN', 'REVOKED', people.adminId, {}],
    ...(platformAdmin ? [['UNIVERSITY_ADMIN', 'USED', platformAdmin.id, {}]] : []),
  ]
  for (const [n, [role, status, createdById, scope]] of extraInvites.entries()) {
    // Срок инвайта — TTL.INVITE_HOURS (48 ч) от создания: живой истекает в ближайшие сутки-двое,
    // остальные — в прошлом.
    const pendingExpires = new Date(Date.now() + random.randInt(6, 40) * HOUR)
    const createdAt =
      status === 'PENDING'
        ? new Date(pendingExpires.getTime() - COMPANY_INVITE_TTL)
        : status === 'USED'
          ? random.randomDate(-450, -430)
          : random.randomDate(-40, -3)
    await writer.add('invite', {
      id: id(index, 'inv', 'x', n),
      token:
        status === 'PENDING'
          ? randomTokenHash()
          : `${id(index, 'invite', 'x', n)}-${status.toLowerCase()}`,
      role,
      email: role === 'UNIVERSITY_ADMIN' ? null : `invite.x${n}@${uniId}.example.kz`,
      universityId: uniId,
      facultyId: scope.facultyId ?? null,
      groupId: scope.groupId ?? null,
      status,
      expiresAt: status === 'PENDING' ? pendingExpires : new Date(createdAt.getTime() + COMPANY_INVITE_TTL), // prettier-ignore
      createdById,
      usedById: status === 'USED' ? people.adminId : null,
      usedAt: status === 'USED' ? new Date(createdAt.getTime() + random.randInt(2, 48) * HOUR) : null, // prettier-ignore
      createdAt,
    })
  }
  await writer.flush()

  // ── Покрытие: каждый вид уведомления и действие журнала аудита ─────────────
  await seedNotificationCoverage(prisma, writer, ctx)
  await seedAuditCoverage(prisma, writer, ctx)

  await writer.flush()
}
