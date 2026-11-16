// Шаг «документы и услуги»: личные и выданные вузом документы со сканами, доступами и
// журналом, типы документов вуза, запросы комплектов и ответы студентов, заявки на услуги
// со всеми статусами и результатами, жалобы и уведомления.
//
// Сканы. Документ без страниц API держит черновиком («Загружен» он становится с первыми
// файлами), поэтому у каждого не-черновика есть хотя бы одна страница. Страницы — ссылки на
// образцы форматов (lib/formats.mjs): PDF, JPEG и PNG по кругу, ровно то, что принимает
// модуль (DOCUMENT_MIME в documents.service). Без хранилища (pool.formats = null) документы
// остаются метаданными, как раньше: списки, доступы и запросы работают и без содержимого.
//
// Каталог услуг глобальный (universityId = null, его создаёт основной сид), поэтому
// заявки ссылаются на него; плюс у каждого вуза свои услуги — по одной на категорию
// каталога, со всеми типами полей анкеты и режимами обработки.
//
// Журнал документов (17 действий × 7 «через что») целиком — в 72-document-journal.mjs:
// здесь только события, которые рождает сама история документа (загрузка, срок, архив,
// доступы, проверка в запросе).

import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'
import { child, id } from '../lib/ids.mjs'
import { seedDocumentJournal } from './72-document-journal.mjs'

const HOUR = 3_600_000

// Что принимает модуль «Документы»: documents.service, DOCUMENT_MIME.
export const DOCUMENT_SCAN_MIMES = ['application/pdf', 'image/jpeg', 'image/png']

// [type, category, статус, срок действия в днях от сегодня (null — бессрочно), страниц].
//
// Статусы согласованы с ночным кроном sweepExpiry: срок в ближайшие 30 дней — EXPIRING,
// прошедший — EXPIRED (раньше «отклонённый» документ с прошедшим сроком крон молча
// переводил в EXPIRED на первом же прогоне). VERIFIED бывает только у сертификатов
// (категория CERTIFICATE), принятых в запросе вуза, — у паспорта его не бывает.
// «На проверке» и часть «принят/подтверждён/требует замены» выводятся из ответа студента на
// запрос (reviewOverride ниже), как это делает syncReviewStatus.
const DOC_TEMPLATES = [
  ['ID_CARD', 'PERSONAL', 'ACCEPTED', 900, 2],
  ['PASSPORT', 'PERSONAL', 'ACCEPTED', 1600, 1],
  ['SCHOOL_CERTIFICATE', 'ACADEMIC', 'ACCEPTED', null, 1],
  ['MEDICAL', 'CERTIFICATE', 'EXPIRING', 12, 1],
  ['STUDY_PLACE', 'CERTIFICATE', 'UPLOADED', 45, 1],
  ['MILITARY_DOCS', 'CERTIFICATE', 'DRAFT', null, 0],
  ['SOCIAL_REFERENCE', 'CERTIFICATE', 'VERIFIED', 200, 1],
  ['BENEFITS_DOCS', 'CERTIFICATE', 'NEEDS_REPLACEMENT', 120, 1],
  ['ACADEMIC_REFERENCE', 'ACADEMIC', 'EXPIRED', -15, 1],
]
const DOC_TITLES = {
  ID_CARD: 'Удостоверение личности',
  PASSPORT: 'Паспорт',
  SCHOOL_CERTIFICATE: 'Аттестат о среднем образовании',
  MEDICAL: 'Медицинская справка 086-У',
  STUDY_PLACE: 'Справка с места учёбы',
  MILITARY_DOCS: 'Приписное свидетельство',
  SOCIAL_REFERENCE: 'Справка о составе семьи',
  BENEFITS_DOCS: 'Документ о льготах',
  ACADEMIC_REFERENCE: 'Академическая справка',
  STUDENT_ID: 'Студенческий билет',
  ENROLLMENT_ORDER: 'Приказ о зачислении',
  STUDY_CONTRACT: 'Договор об оказании образовательных услуг',
  CAMPUS_PASS: 'Пропуск в кампус',
}
const ISSUERS = {
  PERSONAL: 'МВД РК',
  ACADEMIC: 'МОН РК',
  CERTIFICATE: 'Городская поликлиника №4',
}
const REPLACEMENT_REASON = 'Скан нечитаемый — переснимите документ'
// Типы документов, включённые вузом (id из каталога packages/shared-config/documents.ts).
const ENABLED_TYPES = ['ID_CARD','PASSPORT','SCHOOL_CERTIFICATE','DIPLOMA','TRANSCRIPT','MEDICAL','STUDY_PLACE','MILITARY_DOCS','SOCIAL_REFERENCE','BENEFITS_DOCS','ACADEMIC_REFERENCE','PHOTO_3X4','STUDENT_ID','ENROLLMENT_ORDER','CAMPUS_PASS','STUDY_PLACE_REF','TRANSCRIPT_ISSUED'] // prettier-ignore
// Тип, который вуз выключил: переключатель «включён» в настройках вуза должен встречаться в
// обоих положениях. Документов такого типа у студентов сида нет — завести его нельзя.
const DISABLED_TYPE = 'DORMITORY_DOCS'

/**
 * Итог ответа студента на основной запрос комплекта — по номеру студента, а не случайно:
 * на любом объёме встречаются все пять статусов комплекта (DOCUMENT_SUBMISSION_STATUS_VALUES).
 * PARTIAL — проверка начата, но не все позиции решены; REJECTED — хотя бы одна отклонена.
 */
function submissionOutcome(si) {
  if (si % 3 === 2) return 'DRAFT'
  if (si % 4 === 0) return 'ACCEPTED'
  if (si % 5 === 1) return 'PARTIAL'
  if (si % 5 === 3) return 'REJECTED'
  return 'SUBMITTED'
}

// Позиции основного запроса: [тип, название, обязательна].
const REQUEST_ITEMS = [
  ['ID_CARD', 'Удостоверение личности', true],
  ['MEDICAL', 'Медицинская справка 086-У', true],
  ['SOCIAL_REFERENCE', 'Справка о составе семьи', false],
]

/** Вердикт позиции `ri` комплекта с итогом `outcome` (как его оставил сотрудник). */
function itemVerdict(outcome, ri) {
  if (outcome === 'ACCEPTED') return 'ACCEPTED'
  if (outcome === 'PARTIAL') return ri === 0 ? 'ACCEPTED' : 'PENDING'
  if (outcome === 'REJECTED') return ri === 1 ? 'REJECTED' : 'ACCEPTED'
  return 'PENDING'
}

/**
 * Статус документа после проверки в запросе — правило syncReviewStatus: отклонён в открытом
 * запросе → «требует замены», ждёт проверки в отправленном комплекте → «на проверке», принят
 * → «принят», а сертификат своего типа — «подтверждён» (verifyCertificate).
 */
function reviewOverride(outcome, type, category) {
  const ri = REQUEST_ITEMS.findIndex(([t]) => t === type)
  if (ri < 0 || outcome === 'DRAFT') return null
  const verdict = itemVerdict(outcome, ri)
  if (verdict === 'REJECTED') return { status: 'NEEDS_REPLACEMENT', reason: REPLACEMENT_REASON }
  if (verdict === 'PENDING') return { status: 'IN_REVIEW', reason: null }
  return { status: category === 'CERTIFICATE' ? 'VERIFIED' : 'ACCEPTED', reason: null }
}

// Глобальные услуги основного сида: на них ссылаются заявки. Способы выдачи и данные формы —
// по каталогу (steps/05-service-catalog.mjs): заявка на услугу «только бумажно» с
// ELECTRONIC или без обязательного поля формы — состояние, которое API не пропустит.
// `result` — что получает студент по электронной выдаче: выданный вузом документ того типа,
// которым его заводит issueToOwner (заголовок — название услуги).
const GLOBAL_SERVICES = [
  { id: 'seed-appsvc-study-certificate', nameRu: 'Справка с места обучения', requirement: 'seed-appreq-study-certificate-id-card', requirementTitle: 'Удостоверение личности', sla: 8, modes: ['ELECTRONIC', 'PAPER'], delivery: 'ELECTRONIC', formData: { purpose: 'по месту требования' }, result: { type: 'ELECTRONIC_DOCUMENT', docType: 'STUDY_PLACE_REF' } }, // prettier-ignore
  { id: 'seed-appsvc-transcript', nameRu: 'Транскрипт', requirement: 'seed-appreq-transcript-id-card', requirementTitle: 'Удостоверение личности', sla: 48, modes: ['ELECTRONIC', 'PAPER'], delivery: 'ELECTRONIC', formData: {}, result: { type: 'ELECTRONIC_DOCUMENT', docType: 'TRANSCRIPT_ISSUED' } }, // prettier-ignore
  { id: 'seed-appsvc-academic-leave', nameRu: 'Академический отпуск', requirement: 'seed-appreq-academic-leave-id-card', requirementTitle: 'Удостоверение личности', medicalRequirement: 'seed-appreq-academic-leave-medical', sla: 120, modes: ['PAPER'], delivery: 'PAPER', formData: { reason: 'По состоянию здоровья, заключение ВКК прилагаю' }, result: null }, // prettier-ignore
]

// Свои услуги вуза — по одной на каждую категорию каталога, которой нет у глобальных
// (APPLICATION_CATEGORY_CODES), со всеми типами полей анкеты (FormFieldTypeSchema) и тремя
// режимами обработки (ProcessingModeSchema). Данные формы `formData` проходят formDataError:
// число — числом, дата — «ГГГГ-ММ-ДД», флажок «подтверждаю» — отмеченным.
// Первая (общежитие) — прежняя услуга шага: её id не меняется.
const OWN_SERVICES = [
  {
    key: 'dorm',
    category: 'DORMITORY',
    code: 'dormitory-place',
    nameRu: 'Место в общежитии',
    nameKk: 'Жатақханадан орын',
    nameEn: 'Dormitory place',
    descriptionRu: 'Заявление на предоставление места в студенческом общежитии.',
    sla: 72,
    modes: ['ELECTRONIC'],
    processingMode: 'MANUAL',
    facultyScoped: true,
    fields: [
      { code: 'family-status', idPart: 'family', type: 'SELECT', labelRu: 'Основание', labelKk: 'Негіздеме', labelEn: 'Grounds', required: true, options: [{ value: 'far', labelRu: 'Иногородний' }, { value: 'social', labelRu: 'Социальная категория' }] }, // prettier-ignore
    ],
    formData: { 'family-status': 'far' },
    result: { type: 'INFORMATION', note: 'Место в общежитии №2, комната 314. Заселение — с понедельника.' }, // prettier-ignore
  },
  {
    key: 'military',
    category: 'MILITARY',
    code: 'military-registration',
    nameRu: 'Справка для военкомата (форма 4)',
    nameKk: 'Әскери комиссариатқа анықтама (4-нысан)',
    nameEn: 'Military registration certificate',
    descriptionRu: 'Справка об обучении для постановки на воинский учёт и отсрочки.',
    sla: 24,
    modes: ['ELECTRONIC', 'PAPER'],
    processingMode: 'HYBRID',
    facultyScoped: false,
    maxFiles: 2,
    fields: [
      { code: 'birth-year', type: 'NUMBER', labelRu: 'Год рождения', labelKk: 'Туған жылы', labelEn: 'Year of birth', required: true, validation: { min: 1990, max: 2010 } }, // prettier-ignore
      { code: 'visit-date', type: 'DATE', labelRu: 'Дата явки в военкомат', labelKk: 'Комиссариатқа келу күні', labelEn: 'Visit date', required: false }, // prettier-ignore
      { code: 'fitness', type: 'RADIO', labelRu: 'Категория годности', labelKk: 'Жарамдылық санаты', labelEn: 'Fitness category', required: true, options: [{ value: 'A', labelRu: 'А — годен' }, { value: 'B', labelRu: 'Б — годен с ограничениями' }] }, // prettier-ignore
      { code: 'confirm', type: 'CHECKBOX', labelRu: 'Подтверждаю достоверность данных', labelKk: 'Деректердің дұрыстығын растаймын', labelEn: 'I confirm the data is correct', required: true }, // prettier-ignore
    ],
    formData: { 'birth-year': 2005, 'visit-date': '2026-12-01', fitness: 'A', confirm: true },
    result: { type: 'OTHER', note: 'Справка направлена в военкомат по защищённому каналу.' },
  },
  {
    key: 'scholarship',
    category: 'FINANCIAL',
    code: 'social-scholarship',
    nameRu: 'Социальная стипендия',
    nameKk: 'Әлеуметтік стипендия',
    nameEn: 'Social scholarship',
    descriptionRu: 'Назначение социальной стипендии по документам о льготах.',
    sla: 96,
    modes: ['ELECTRONIC'],
    processingMode: 'MANUAL',
    facultyScoped: true,
    fields: [
      { code: 'large-family', type: 'BOOLEAN', labelRu: 'Многодетная семья', labelKk: 'Көпбалалы отбасы', labelEn: 'Large family', required: true }, // prettier-ignore
      { code: 'income', type: 'NUMBER', labelRu: 'Доход на члена семьи, ₸', labelKk: 'Отбасы мүшесіне табыс, ₸', labelEn: 'Income per family member, KZT', required: false, validation: { min: 0 } }, // prettier-ignore
    ],
    formData: { 'large-family': false, income: 120000 },
    result: { type: 'INFORMATION', note: 'Стипендия назначена с первого числа следующего месяца.' },
  },
  {
    key: 'personal-data',
    category: 'PERSONAL_DATA',
    code: 'personal-data-change',
    nameRu: 'Изменение персональных данных',
    nameKk: 'Жеке деректерді өзгерту',
    nameEn: 'Personal data change',
    descriptionRu: 'Смена фамилии или документа, удостоверяющего личность, в личном деле.',
    sla: 48,
    modes: ['ELECTRONIC'],
    processingMode: 'MANUAL',
    facultyScoped: false,
    fields: [
      { code: 'new-last-name', type: 'TEXT', labelRu: 'Новая фамилия', labelKk: 'Жаңа тегі', labelEn: 'New last name', required: true, validation: { minLength: 2, maxLength: 60 } }, // prettier-ignore
    ],
    formData: { 'new-last-name': 'Сейткали' },
    result: { type: 'OTHER', note: 'Изменения внесены в личное дело.' },
  },
  {
    key: 'it-access',
    category: 'TECHNICAL',
    code: 'it-account-reset',
    nameRu: 'Восстановление доступа к корпоративной почте',
    nameKk: 'Корпоративтік поштаға қолжетімділікті қалпына келтіру',
    nameEn: 'Corporate mail access recovery',
    descriptionRu: 'Сброс пароля корпоративной почты и Wi-Fi кампуса.',
    sla: 4,
    modes: ['ELECTRONIC'],
    processingMode: 'AUTOMATIC',
    facultyScoped: false,
    fields: [
      { code: 'details', type: 'TEXTAREA', labelRu: 'Что случилось', labelKk: 'Не болды', labelEn: 'What happened', required: false }, // prettier-ignore
    ],
    formData: { details: 'Не приходит код подтверждения на телефон.' },
    result: { type: 'INFORMATION', note: 'Временный пароль отправлен на личную почту.' },
  },
  {
    // Снятая с каталога услуга (active = false): в настройках вуза она видна выключенной,
    // студенту не показывается, заявок по ней нет.
    key: 'misc',
    category: 'OTHER',
    code: 'misc-request',
    nameRu: 'Обращение в деканат',
    nameKk: 'Деканатқа өтініш',
    nameEn: 'Request to the dean’s office',
    descriptionRu: 'Свободное обращение — заменено отдельными услугами.',
    sla: 72,
    modes: ['ELECTRONIC', 'PAPER'],
    processingMode: 'MANUAL',
    facultyScoped: true,
    active: false,
    fields: [],
    formData: {},
    result: null,
  },
]

// Статусы заявки и их «геометрия»: какие даты заполнены и что в журнале.
// Все двенадцать статусов из APPLICATION_STATUSES
// (packages/shared-schemas/application-services.ts): каждая вкладка фильтра в очереди
// сотрудника должна быть непустой, а «новые» и «в работе» — преобладать, как в жизни.
const APP_FLOWS = [
  ['DRAFT', 14],
  ['SUBMITTED', 16],
  ['IN_REVIEW', 13],
  ['NEEDS_CORRECTION', 7],
  ['RESUBMITTED', 6],
  ['IN_PREPARATION', 8],
  ['READY', 10],
  ['READY_FOR_PICKUP', 6],
  ['ISSUED', 9],
  ['DELIVERED', 3],
  ['REJECTED', 4],
  ['CANCELLED', 4],
]
// «Готово к получению» и «выдано» — оригинал на руках: только бумажная выдача (или «оба
// способа»). «Готово» и «предоставлено» — только электронная (markReady/issue/deliver).
const PAPER_STATUSES = new Set(['READY_FOR_PICKUP', 'ISSUED'])
const ELECTRONIC_STATUSES = new Set(['READY', 'DELIVERED'])
const PREPARED_STATUSES = new Set(['IN_PREPARATION', 'READY', 'READY_FOR_PICKUP', 'ISSUED', 'DELIVERED']) // prettier-ignore
// Причина отзыва справки по умолчанию — как REVOKED_REASON в application-process.service.
const REVOKED_REASON = 'Справка отозвана университетом'

const COMPLAINT_REASONS = [
  'Спам в комментариях',
  'Оскорбление в личных сообщениях',
  'Недостоверная информация в посте',
  'Реклама сторонних услуг',
  'Нарушение правил сообщества',
]
// Приоритет — по категории цели, как complaintPriorityFor (shared-schemas/complaints.ts):
// раньше жалоба на комментарий получала MEDIUM, и значения LOW в базе не было вовсе.
const PRIORITY_BY_TARGET = { USER: 'HIGH', MESSAGE: 'HIGH', POST: 'MEDIUM', STORY: 'MEDIUM', COMMENT: 'LOW' } // prettier-ignore
const NOTIFICATIONS = [
  ['SCHEDULE_CHANGE', 'Изменение в расписании', 'Пара по расписанию перенесена. Проверьте раздел «Изменения».'], // prettier-ignore
  ['APP_UPDATE', 'Статус заявки изменён', 'Ваша заявка перешла в статус «Готово».'],
  ['MESSAGE', 'Новое сообщение', 'Вам написали в чате группы.'],
  ['POST', 'Новое объявление', 'Опубликовано объявление деканата.'],
  ['EVENT', 'Скоро событие', 'Мероприятие начнётся через час.'],
  ['SYSTEM', 'Добро пожаловать', 'Профиль создан. Заполните раздел «Портфолио».'],
]

const last4Of = (number) => number.slice(-4)

export async function seedServices(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))

  // Сканы: круговой выбор формата, чтобы на любом объёме встречались все три. Выданные
  // вузом документы — PDF: их формирует сотрудник (справка, приказ, договор).
  const nextScan = formatCycler(formatSamples(pool?.formats, 'documents', { mimes: DOCUMENT_SCAN_MIMES })) // prettier-ignore
  const nextPdf = formatCycler(formatSamples(pool?.formats, 'documents', { mimes: ['application/pdf'] })) // prettier-ignore
  let scanNo = 0
  // Строки File копятся до флаша документов: поток `file` открыт ещё шагами академики и
  // соцчасти, то есть в порядке записи writer'а он СТОИТ РАНЬШЕ `document`, и страница,
  // ушедшая в базу раньше своего документа, упала бы на files_document_id_fkey.
  const scanRows = []
  const addPages = (documentId, ownerId, pages, createdAt, pick = nextScan) => {
    for (let p = 0; p < pages; p += 1) {
      const sample = pick()
      if (!sample) return
      scanRows.push(
        formatFileRow(sample, scanNo++, {
          id: child(documentId, 'p', p),
          ownerId,
          documentId,
          order: p,
          createdAt,
        }),
      )
    }
  }

  // ── Типы документов вуза (включённые, один выключенный и один свой) ──────────
  for (const [ti, typeId] of ENABLED_TYPES.entries()) {
    await writer.add('documentType', {
      id: id(index, 'dt', typeId.toLowerCase()),
      universityId: uniId,
      typeId,
      enabled: true,
      // Срок хранения после истечения — половине типов, чтобы политика была видна.
      retentionDays: ti % 2 === 0 ? random.pick([180, 365, 730]) : null,
    })
  }
  await writer.add('documentType', {
    id: id(index, 'dt', DISABLED_TYPE.toLowerCase()),
    universityId: uniId,
    typeId: DISABLED_TYPE,
    enabled: false,
  })
  await writer.add('documentType', {
    id: id(index, 'dt', 'custom-practice'),
    universityId: uniId,
    typeId: 'PRACTICE_REPORT',
    custom: true,
    enabled: true,
    category: 'ACADEMIC',
    label: 'Отчёт по практике',
    fields: ['number', 'issuedAt', 'issuedBy'],
    retentionDays: 365,
  })

  // ── Свои услуги вуза: требование и поля формы ───────────────────────────────
  const ownServices = []
  for (const [oi, svc] of OWN_SERVICES.entries()) {
    const serviceId = id(index, 'svc', svc.key)
    await writer.add('applicationService', {
      id: serviceId,
      categoryId: `seed-appcat-${svc.category.toLowerCase()}`,
      universityId: uniId,
      code: svc.code,
      nameRu: svc.nameRu,
      nameKk: svc.nameKk,
      nameEn: svc.nameEn,
      descriptionRu: svc.descriptionRu,
      slaHours: svc.sla,
      deliveryModes: svc.modes,
      requiresPickup: svc.modes.includes('PAPER'),
      facultyScoped: svc.facultyScoped,
      processingMode: svc.processingMode,
      active: svc.active ?? true,
      sortOrder: 10 + oi,
    })
    const requirementId = child(serviceId, 'req', 'id-card')
    await writer.add('serviceRequirement', {
      id: requirementId,
      serviceId,
      code: 'id-card',
      documentType: 'ID_CARD',
      titleRu: 'Удостоверение личности',
      titleKk: 'Жеке куәлік',
      titleEn: 'ID card',
      required: true,
      // Лицевая и оборотная сторона отдельными файлами — там, где это нужно военкомату.
      maxFiles: svc.maxFiles ?? 1,
      sortOrder: 1,
    })
    for (const [fi, f] of svc.fields.entries()) {
      await writer.add('serviceFormField', {
        id: child(serviceId, 'fld', f.idPart ?? f.code),
        serviceId,
        code: f.code,
        type: f.type,
        labelRu: f.labelRu,
        labelKk: f.labelKk,
        labelEn: f.labelEn,
        required: f.required,
        ...(f.options ? { options: f.options } : {}),
        ...(f.validation ? { validation: f.validation } : {}),
        sortOrder: fi + 1,
      })
    }
    if (svc.active === false) continue
    ownServices.push({
      id: serviceId,
      nameRu: svc.nameRu,
      requirement: requirementId,
      requirementTitle: 'Удостоверение личности',
      sla: svc.sla,
      modes: svc.modes,
      delivery: svc.modes[0],
      formData: svc.formData,
      result: svc.result,
    })
  }
  await writer.flush()

  // ── Документы студентов: у всех, по 5–9 позиций + выданные вузом ────────────
  // Набор у каждого свой, поэтому запоминаем, какие типы реально созданы: ответ на
  // запрос вуза ссылается на документ по FK, и «предположить», что он есть, нельзя.
  const docTypesByStudent = new Map()
  for (const [si, studentId] of allStudents.entries()) {
    const outcome = submissionOutcome(si)
    const take = random.randInt(5, DOC_TEMPLATES.length)
    docTypesByStudent.set(studentId, new Set(DOC_TEMPLATES.slice(0, take).map(([t]) => t)))
    for (let i = 0; i < take; i += 1) {
      const [type, category, baseStatus, expiresIn, pages] = DOC_TEMPLATES[i]
      const documentId = child(studentId, 'doc', type)
      const review = reviewOverride(outcome, type, category)
      const status = review?.status ?? baseStatus
      const archived = status === 'ACCEPTED' && !review && random.chance(0.1)
      const last4 = String(1000 + random.randInt(0, 8999))
      const createdAt = random.randomDate(-400, -5)
      await writer.add('document', {
        id: documentId,
        ownerId: studentId,
        universityId: uniId,
        category,
        type,
        title: DOC_TITLES[type] ?? type,
        number: `AA${random.randInt(100000, 999999)}${last4}`,
        numberLast4: last4,
        issuedBy: ISSUERS[category],
        issuedAt: random.randomDate(-2000, -200),
        expiresAt: expiresIn === null ? null : random.daysFromNow(expiresIn),
        status: archived ? 'ARCHIVED' : status,
        rejectionReason:
          status === 'NEEDS_REPLACEMENT' ? (review?.reason ?? REPLACEMENT_REASON) : null,
        archivedAt: archived ? random.randomDate(-120, -10) : null,
        createdAt,
      })
      // Черновик — документ без страниц (API ставит DRAFT, пока файлов нет).
      if (status !== 'DRAFT') addPages(documentId, studentId, pages, createdAt)
      await writer.add('documentEvent', {
        id: child(documentId, 'ev', 'up'),
        documentId,
        actorId: studentId,
        action: 'UPLOAD',
        // Как пишет attachFiles: сколько страниц пришло первой загрузкой.
        metadata: status === 'DRAFT' ? { created: true } : { added: pages },
        createdAt,
      })
      // Срок: событие пишет крон sweepExpiry от имени владельца — журнал показывает его
      // «системным» (journalVia: EXPIRING/EXPIRE → SYSTEM).
      if (status === 'EXPIRING' || status === 'EXPIRED') {
        await writer.add('documentEvent', {
          id: child(documentId, 'ev', 'expiry'),
          documentId,
          actorId: studentId,
          action: status === 'EXPIRED' ? 'EXPIRE' : 'EXPIRING',
          createdAt: random.randomDate(-10, 0),
        })
      }
      // Архив — с прежним статусом в событии: по нему возврат из архива его восстановит.
      if (archived) {
        await writer.add('documentEvent', {
          id: child(documentId, 'ev', 'archive'),
          documentId,
          actorId: studentId,
          action: 'ARCHIVE',
          metadata: { archived: true, previousStatus: status },
          createdAt: random.randomDate(-120, -10),
        })
      }
      // Доступы: активные, отозванные и просроченные — все три состояния должны
      // встречаться на экране «Управление доступом».
      if (i < 2 && random.chance(0.6)) {
        const expired = random.chance(0.35)
        const revoked = !expired && random.chance(0.25)
        const toFaculty = random.chance(0.4)
        const granteeType = toFaculty ? 'DEPARTMENT' : 'UNIVERSITY'
        await writer.add('documentAccess', {
          id: child(documentId, 'acc'),
          documentId,
          granteeType,
          granteeId: toFaculty ? people.faculties[si % people.faculties.length].id : null,
          reason: random.pick([
            'оформление личного дела',
            'проверка данных при заселении',
            'подготовка приказа о зачислении',
          ]),
          grantedById: studentId,
          grantedAt: random.randomDate(-300, -30),
          expiresAt: expired ? random.randomDate(-40, -1) : random.chance(0.5) ? random.daysFromNow(180) : null, // prettier-ignore
          revokedAt: revoked ? random.randomDate(-20, -1) : null,
        })
        await writer.add('documentEvent', {
          id: child(documentId, 'ev', 'grant'),
          documentId,
          actorId: studentId,
          action: 'GRANT',
          metadata: { granteeType },
          createdAt: random.randomDate(-300, -30),
        })
        if (revoked) {
          await writer.add('documentEvent', {
            id: child(documentId, 'ev', 'revoke'),
            documentId,
            actorId: studentId,
            action: 'REVOKE',
            metadata: { granteeType },
            createdAt: random.randomDate(-20, -1),
          })
        }
      }
    }
    // Выданные вузом: файл загружает сотрудник (админ вуза), он же автор события — журнал
    // показывает его «сотрудником» (journalVia → STAFF), как issueToOwner.
    for (const type of ['STUDENT_ID', 'ENROLLMENT_ORDER', 'STUDY_CONTRACT']) {
      const documentId = child(studentId, 'doc', type)
      const last4 = String(1000 + random.randInt(0, 8999))
      const issuedAt = random.randomDate(-1000, -100)
      await writer.add('document', {
        id: documentId,
        ownerId: studentId,
        universityId: uniId,
        category: 'ISSUED_BY_UNIVERSITY',
        type,
        title: DOC_TITLES[type],
        number: `${uniId}-${last4}`,
        numberLast4: last4,
        issuedBy: structure.profile.name,
        issuedAt,
        status: 'ACCEPTED',
        issuedByUniversity: true,
        createdAt: issuedAt,
      })
      addPages(documentId, people.adminId, 1, issuedAt, nextPdf)
      await writer.add('documentEvent', {
        id: child(documentId, 'ev', 'up'),
        documentId,
        actorId: people.adminId,
        action: 'UPLOAD',
        metadata: { issuedTo: studentId },
        createdAt: issuedAt,
      })
    }
  }
  await writer.flush()
  await writer.addMany('file', scanRows.splice(0))
  await writer.flush()

  // ── Запрос комплекта документов + ответы студентов ──────────────────────────
  const requestId = id(index, 'docreq')
  const requestAuthor = people.faculties[0].deanId
  const requestCreatedAt = random.randomDate(-30, -20)
  await writer.add('documentRequest', {
    id: requestId,
    universityId: uniId,
    createdById: requestAuthor,
    title: 'Комплект документов на новый учебный год',
    description: 'Загрузите действующие документы до начала сессии.',
    dueAt: random.daysFromNow(21),
    status: 'OPEN',
    createdAt: requestCreatedAt,
  })
  for (const [ri, [documentType, title, required]] of REQUEST_ITEMS.entries()) {
    await writer.add('documentRequestItem', {
      id: child(requestId, 'it', ri),
      requestId,
      documentType,
      title,
      required,
      order: ri,
    })
  }
  await writer.add('documentRequestTarget', {
    id: child(requestId, 'tg'),
    requestId,
    targetType: 'UNIVERSITY',
    targetId: null,
  })
  await writer.add('documentEvent', {
    id: child(requestId, 'ev', 'create'),
    requestId,
    actorId: requestAuthor,
    action: 'REQUEST_CREATE',
    metadata: { items: REQUEST_ITEMS.length },
    createdAt: requestCreatedAt,
  })
  await writer.flush()

  // Ответы: все пять статусов комплекта — по номеру студента (submissionOutcome), на
  // экране сотрудника должны быть видны все стадии. Статусы самих документов выше уже
  // согласованы с этими вердиктами (reviewOverride).
  //
  // События проверки (SUBMIT, ACCEPT/REJECT, REVIEW) пишутся на каждый документ комплекта —
  // по 4–7 строк на студента. Журналу нужны примеры, а не полная история каждого, поэтому
  // события — только у первых JOURNAL_SAMPLE комплектов: в них есть все пять итогов.
  const JOURNAL_SAMPLE = 40
  for (const [si, studentId] of allStudents.entries()) {
    const outcome = submissionOutcome(si)
    const sent = outcome !== 'DRAFT'
    const reviewed = outcome === 'ACCEPTED' || outcome === 'PARTIAL' || outcome === 'REJECTED'
    const submissionId = child(studentId, 'docsub')
    const submittedAt = sent ? random.randomDate(-10, -2) : null
    const reviewedAt = reviewed ? new Date(submittedAt.getTime() + random.randInt(2, 30) * HOUR) : null // prettier-ignore
    await writer.add('documentSubmission', {
      id: submissionId,
      requestId,
      studentId,
      status: outcome,
      submittedAt,
      // Черновик сотрудник не видит и не проверяет: у него не бывает ни проверяющего, ни
      // решённых позиций.
      reviewedById: reviewed ? requestAuthor : null,
      reviewedAt,
    })
    const documentIds = []
    for (const [ri, [documentType]] of REQUEST_ITEMS.entries()) {
      const has = docTypesByStudent.get(studentId)?.has(documentType)
      const documentId = has ? child(studentId, 'doc', documentType) : null
      if (documentId) documentIds.push(documentId)
      // Позиция без документа (необязательная, документа у студента нет) — не проверяется.
      const verdict = documentId ? itemVerdict(outcome, ri) : 'PENDING'
      const decided = verdict !== 'PENDING'
      const itemId = child(submissionId, 'it', ri)
      await writer.add('documentSubmissionItem', {
        id: itemId,
        submissionId,
        requestItemId: child(requestId, 'it', ri),
        documentId,
        status: verdict,
        rejectionReason: verdict === 'REJECTED' ? REPLACEMENT_REASON : null,
        reviewedById: decided ? requestAuthor : null,
        reviewedAt: decided ? reviewedAt : null,
      })
      if (si < JOURNAL_SAMPLE && decided) {
        await writer.add('documentEvent', {
          id: child(itemId, 'ev', 'verdict'),
          documentId,
          requestId,
          actorId: requestAuthor,
          action: verdict === 'ACCEPTED' ? 'ACCEPT' : 'REJECT',
          metadata: {
            submissionItemId: itemId,
            ...(verdict === 'REJECTED' ? { reason: REPLACEMENT_REASON } : {}),
          },
          createdAt: reviewedAt,
        })
      }
    }
    if (si >= JOURNAL_SAMPLE || !sent) continue
    for (const documentId of documentIds) {
      await writer.add('documentEvent', {
        id: child(submissionId, 'ev', 'submit', documentId.slice(studentId.length + 1)),
        documentId,
        requestId,
        actorId: studentId,
        action: 'SUBMIT',
        metadata: { submissionId },
        createdAt: submittedAt,
      })
      if (reviewed) {
        await writer.add('documentEvent', {
          id: child(submissionId, 'ev', 'review', documentId.slice(studentId.length + 1)),
          documentId,
          requestId,
          actorId: requestAuthor,
          action: 'REVIEW',
          metadata: { status: outcome, submissionId },
          createdAt: reviewedAt,
        })
      }
    }
  }
  await writer.flush()

  // ── Закрытый запрос, адресованный факультету, группе и одному студенту ─────
  // Адресаты FACULTY/GROUP/USER и статус CLOSED (DOCUMENT_REQUEST_*_VALUES): основной
  // запрос открыт и адресован всему вузу. Ответы — только у группы-адресата: принятые
  // комплекты, один отклонённый (вердикты закрытого запроса — история, статус документа
  // они не пересчитывают) и неотправленный черновик у студента-адресата.
  const closedId = id(index, 'docreq', 'closed')
  const lastFaculty = people.faculties[people.faculties.length - 1]
  const closedGroup = lastFaculty.groups[0]
  const closedAuthor = lastFaculty.deanId
  const closedCreatedAt = random.randomDate(-120, -90)
  const closedAt = new Date(closedCreatedAt.getTime() + 21 * 24 * HOUR)
  await writer.add('documentRequest', {
    id: closedId,
    universityId: uniId,
    createdById: closedAuthor,
    title: 'Документы для личного дела первокурсника',
    description: 'Паспорт и аттестат для сверки с личным делом. Приём завершён.',
    dueAt: closedAt,
    status: 'CLOSED',
    createdAt: closedCreatedAt,
  })
  const closedItems = [
    ['SCHOOL_CERTIFICATE', 'Аттестат о среднем образовании', true],
    ['PASSPORT', 'Паспорт', false],
  ]
  for (const [ri, [documentType, title, required]] of closedItems.entries()) {
    await writer.add('documentRequestItem', {
      id: child(closedId, 'it', ri),
      requestId: closedId,
      documentType,
      title,
      required,
      order: ri,
    })
  }
  const userTarget = people.faculties[0].groups[0].studentIds.at(-1)
  for (const [ti, [targetType, targetId]] of [
    ['FACULTY', people.faculties[0].id],
    ['GROUP', closedGroup.id],
    ['USER', userTarget],
  ].entries()) {
    await writer.add('documentRequestTarget', {
      id: child(closedId, 'tg', ti),
      requestId: closedId,
      targetType,
      targetId,
    })
  }
  await writer.add('documentEvent', {
    id: child(closedId, 'ev', 'create'),
    requestId: closedId,
    actorId: closedAuthor,
    action: 'REQUEST_CREATE',
    metadata: { items: closedItems.length },
    createdAt: closedCreatedAt,
  })
  await writer.add('documentEvent', {
    id: child(closedId, 'ev', 'close'),
    requestId: closedId,
    actorId: closedAuthor,
    action: 'REQUEST_CLOSE',
    createdAt: closedAt,
  })
  await writer.flush()
  const closedResponders = [...closedGroup.studentIds.slice(0, 8), userTarget]
  for (const [ci, studentId] of closedResponders.entries()) {
    const isDraft = studentId === userTarget
    const rejected = !isDraft && ci === 1
    const submissionId = child(studentId, 'docsub', 'closed')
    const submittedAt = isDraft ? null : new Date(closedCreatedAt.getTime() + (ci + 1) * 24 * HOUR)
    const reviewedAt = isDraft ? null : new Date(submittedAt.getTime() + 6 * HOUR)
    await writer.add('documentSubmission', {
      id: submissionId,
      requestId: closedId,
      studentId,
      status: isDraft ? 'DRAFT' : rejected ? 'REJECTED' : 'ACCEPTED',
      submittedAt,
      reviewedById: isDraft ? null : closedAuthor,
      reviewedAt,
    })
    for (const [ri, [documentType]] of closedItems.entries()) {
      const has = docTypesByStudent.get(studentId)?.has(documentType)
      const status = isDraft || !has ? 'PENDING' : rejected && ri === 0 ? 'REJECTED' : 'ACCEPTED'
      await writer.add('documentSubmissionItem', {
        id: child(submissionId, 'it', ri),
        submissionId,
        requestItemId: child(closedId, 'it', ri),
        documentId: has ? child(studentId, 'doc', documentType) : null,
        status,
        rejectionReason: status === 'REJECTED' ? 'Аттестат без приложения с оценками' : null,
        reviewedById: status === 'PENDING' ? null : closedAuthor,
        reviewedAt: status === 'PENDING' ? null : reviewedAt,
      })
    }
  }
  await writer.flush()

  // ── Заявки на услуги: все статусы, журнал переходов, документы и результаты ──
  // Номер заявки уникален глобально, поэтому он должен быть СТРУКТУРНЫМ, а не
  // счётчиком обхода: счётчик зависит от плана вуза, и при его изменении номер
  // достался бы другой заявке — строка молча пропускается по уникальному индексу, а
  // её события и документы падают по FK (см. историю с username в шаге 30).
  const structuralNo = (fi, gi, si) => (fi + 1) * 100_000 + (gi + 1) * 100 + (si + 1)
  const flatStudents = []
  for (const [fi, faculty] of people.faculties.entries()) {
    for (const [gi, group] of faculty.groups.entries()) {
      for (const [si, studentId] of group.studentIds.entries()) {
        flatStudents.push({ studentId, faculty, no: structuralNo(fi, gi, si) })
      }
    }
  }
  // Справку об обучении не выдают отчисленному, выпускнику или переведённому
  // (isTerminalAcademicStatus): таким студентам электронный результат — транскрипт.
  const inactive = people.studentStatus ?? new Map()
  const resultFiles = []
  let revokedCertificate = false

  for (const [si, { studentId, faculty, no }] of flatStudents.entries()) {
    // Первые двенадцать заявок вуза проходят по всем статусам подряд — на любом объёме вуза
    // каждая вкладка очереди непуста; дальше — реалистичная пропорция.
    const status = si < APP_FLOWS.length ? APP_FLOWS[si][0] : random.pickWeighted(APP_FLOWS)
    const useOwn = random.chance(0.3)
    // Способ выдачи диктует статус: бумажные стадии — PAPER (или «оба» там, где услуга
    // умеет оба), электронные — ELECTRONIC. Услугу, которая так не умеет, заменяем справкой.
    const need = PAPER_STATUSES.has(status) ? 'PAPER' : ELECTRONIC_STATUSES.has(status) ? 'ELECTRONIC' : null // prettier-ignore
    let service = useOwn ? ownServices[si % ownServices.length] : GLOBAL_SERVICES[si % GLOBAL_SERVICES.length] // prettier-ignore
    if (need && !service.modes.includes(need)) service = GLOBAL_SERVICES[0]
    // Первая «подготовка» вуза — справка (с ней разыгрывается отзыв), первая «выдача» — справка
    // «обоими способами»: иначе оба сценария зависели бы от случайного выбора услуги.
    const showcase = si < APP_FLOWS.length && (status === 'IN_PREPARATION' || status === 'ISSUED')
    if (showcase) service = GLOBAL_SERVICES[0]
    if (service === GLOBAL_SERVICES[0] && inactive.has(studentId)) service = GLOBAL_SERVICES[1]
    const delivery =
      need === 'PAPER'
        ? service.modes.includes('ELECTRONIC') && (si % 2 === 0 || showcase)
          ? 'BOTH'
          : 'PAPER'
        : (need ?? service.delivery)

    const applicationId = child(studentId, 'app')
    const appNumber = `${uniId}-${String(no).padStart(6, '0')}`
    const isDraft = status === 'DRAFT'
    const created = random.randomDate(-25, -3)
    const submitted = isDraft ? null : new Date(created.getTime() + random.randInt(1, 20) * HOUR)
    const isReady = ['READY', 'READY_FOR_PICKUP', 'ISSUED', 'DELIVERED'].includes(status)
    const prepared = PREPARED_STATUSES.has(status)
    // Черновик и отменённая заявка в работу не берутся.
    const inWork = !['DRAFT', 'SUBMITTED', 'CANCELLED'].includes(status)
    const staffId = si % 5 === 0 ? people.adminId : faculty.deanId
    // Возврат на исправление: через отклонённый документ (DOCUMENT_REJECTED) или на
    // уровне заявки (STATUS_CHANGED с комментарием) — оба пути API.
    const correction = status === 'NEEDS_CORRECTION' || status === 'RESUBMITTED'
    const viaDocument = correction && si % 2 === 0
    // Электронный результат нужен до «готово» у электронной выдачи и у «обоих способов»
    // (markReady/deliver проверяют действующий результат); у бумажной — запись о выдаче.
    const electronicResult = service.result && delivery !== 'PAPER' && (isReady || (status === 'IN_PREPARATION' && (si % 2 === 0 || showcase))) // prettier-ignore
    const paperResult = status === 'ISSUED' && delivery !== 'ELECTRONIC'
    // Отозванная справка: одна на вуз, на этапе подготовки — ждёт перевыпуска.
    const revoke =
      !revokedCertificate &&
      status === 'IN_PREPARATION' &&
      electronicResult &&
      service.result.docType === 'STUDY_PLACE_REF'
    if (revoke) revokedCertificate = true

    // Время событий идёт вперёд от создания и не уходит в будущее.
    let at = created.getTime()
    const step = () => {
      at = Math.min(Date.now() - 60_000, at + random.randInt(1, 30) * HOUR)
      return new Date(at)
    }
    const events = []
    const push = (action, fromStatus, toStatus, actorId, extra = {}) =>
      events.push({ action, fromStatus, toStatus, actorId, createdAt: step(), ...extra })

    push('CREATED', null, 'DRAFT', studentId)
    const attached = !isDraft || si % 2 === 1
    const requirements = [[service.requirement, service.requirementTitle, 'ID_CARD', '']]
    if (service.medicalRequirement) {
      requirements.push([
        service.medicalRequirement,
        'Медицинское заключение',
        'MEDICAL',
        'medical',
      ])
    }
    if (attached) {
      for (const [requirementId, title] of requirements) {
        push('DOCUMENT_ADDED', null, null, studentId, { comment: title, metadata: { requirementId } }) // prettier-ignore
      }
    }
    if (isDraft && si % 4 === 0) push('FORM_UPDATED', null, null, studentId)
    if (!isDraft) push('SUBMITTED', 'DRAFT', 'SUBMITTED', studentId)
    if (status === 'CANCELLED') push('CANCELLED', 'SUBMITTED', 'CANCELLED', studentId)
    if (inWork) push('ASSIGNED', 'SUBMITTED', 'IN_REVIEW', staffId)
    if (correction) {
      if (viaDocument) {
        push('DOCUMENT_REJECTED', 'IN_REVIEW', 'NEEDS_CORRECTION', staffId, { comment: 'Приложите разворот с фотографией' }) // prettier-ignore
      } else {
        push('STATUS_CHANGED', 'IN_REVIEW', 'NEEDS_CORRECTION', staffId, { comment: 'Уточните место требования справки' }) // prettier-ignore
      }
    }
    if (status === 'RESUBMITTED') {
      if (viaDocument) push('DOCUMENT_ADDED', null, null, studentId, { comment: service.requirementTitle, metadata: { requirementId: service.requirement } }) // prettier-ignore
      push('RESUBMITTED', 'NEEDS_CORRECTION', 'RESUBMITTED', studentId)
    }
    if (status === 'REJECTED') push('REJECTED', 'IN_REVIEW', 'REJECTED', staffId, { comment: 'Приложен нечитаемый скан документа' }) // prettier-ignore
    if (prepared) {
      for (const [requirementId, title] of requirements) {
        push('DOCUMENT_ACCEPTED', null, null, staffId, { comment: title, metadata: { requirementId } }) // prettier-ignore
      }
      push('STATUS_CHANGED', 'IN_REVIEW', 'IN_PREPARATION', staffId)
    }
    if (electronicResult || paperResult) push('RESULT_ADDED', null, null, staffId)
    if (revoke) push('RESULT_REVOKED', null, null, staffId, { comment: 'Ошибка в дате рождения' })
    if (status === 'READY' || status === 'DELIVERED') push('READY', 'IN_PREPARATION', 'READY', staffId) // prettier-ignore
    if (PAPER_STATUSES.has(status)) push('READY', 'IN_PREPARATION', 'READY_FOR_PICKUP', staffId)
    if (status === 'ISSUED') push('ISSUED', 'READY_FOR_PICKUP', 'ISSUED', staffId)
    if (status === 'DELIVERED') push('DELIVERED', 'READY', 'DELIVERED', staffId)

    const when = (action, toStatus) =>
      events.find((e) => e.action === action && (!toStatus || e.toStatus === toStatus))?.createdAt ?? null // prettier-ignore
    const readyAt = isReady ? when('READY') : null
    await writer.add('application', {
      id: applicationId,
      // Номер уникален глобально — поэтому с префиксом вуза.
      number: isDraft ? null : appNumber,
      studentId,
      universityId: uniId,
      facultyId: faculty.id,
      serviceId: service.id,
      status,
      deliveryType: delivery,
      formData: service.formData,
      assignedToId: inWork ? staffId : null,
      assignedAt: inWork ? when('ASSIGNED') : null,
      submittedAt: submitted,
      startedAt: inWork ? when('ASSIGNED') : null,
      // Срок по SLA от подачи — так на экране очереди видно и просрочку, и запас.
      dueAt: submitted ? new Date(submitted.getTime() + service.sla * HOUR) : null,
      readyAt,
      issuedAt: status === 'ISSUED' ? when('ISSUED') : null,
      issuedById: status === 'ISSUED' ? staffId : null,
      cancelledAt: status === 'CANCELLED' ? when('CANCELLED') : null,
      rejectionReason:
        status === 'REJECTED'
          ? 'Приложен нечитаемый скан документа'
          : status === 'NEEDS_CORRECTION' && !viaDocument
            ? 'Уточните место требования справки'
            : null,
      // Код, место и инструкции выдачи ставит markReady бумажной выдаче — и они остаются
      // у заявки после выдачи оригинала.
      pickupCode: PAPER_STATUSES.has(status) ? `${uniId}-P${String(no).padStart(6, '0')}` : null,
      pickupLocation: PAPER_STATUSES.has(status) ? 'Деканат, кабинет 210' : null,
      pickupInstructions: PAPER_STATUSES.has(status)
        ? 'Возьмите с собой удостоверение личности.'
        : null,
      createdAt: created,
    })
    for (const [ei, e] of events.entries()) {
      await writer.add('applicationEvent', {
        id: child(applicationId, 'ev', ei),
        applicationId,
        actorId: e.actorId,
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        comment: e.comment ?? null,
        ...(e.metadata ? { metadata: e.metadata } : {}),
        createdAt: e.createdAt,
      })
    }

    // Приложенные документы из хранилища — по требованиям услуги.
    if (attached) {
      for (const [requirementId, title, docType, suffix] of requirements) {
        const replaced = correction && viaDocument && !suffix
        const docStatus = prepared
          ? 'ACCEPTED'
          : replaced && status === 'NEEDS_CORRECTION'
            ? 'REPLACEMENT_REQUIRED'
            : 'PENDING'
        const reviewed = docStatus !== 'PENDING'
        await writer.add('applicationDocument', {
          id: suffix ? child(applicationId, 'doc', suffix) : child(applicationId, 'doc'),
          applicationId,
          requirementId,
          documentId: child(studentId, 'doc', docType),
          source: 'STORAGE',
          status: docStatus,
          reviewComment: docStatus === 'REPLACEMENT_REQUIRED' ? 'Приложите разворот с фотографией' : null, // prettier-ignore
          snapshotTitle: title,
          reviewedById: reviewed ? staffId : null,
          reviewedAt: reviewed ? (when('DOCUMENT_ACCEPTED') ?? when('DOCUMENT_REJECTED')) : null,
          submittedAt: when('DOCUMENT_ADDED') ?? created,
        })
      }
    }

    // Результат. Электронный документ заводится на имя студента в «Выданных университетом»
    // (issueToOwner): заголовок — название услуги, файл загрузил сотрудник, статус UPLOADED.
    // Отозванная справка — REJECTED с причиной, как revokeStudyCertificate.
    if (electronicResult) {
      const { type, docType, note } = service.result
      let documentId = null
      if (type === 'ELECTRONIC_DOCUMENT') {
        documentId = child(studentId, 'doc', docType)
        const issuedAt = when('RESULT_ADDED')
        await writer.add('document', {
          id: documentId,
          ownerId: studentId,
          universityId: uniId,
          category: 'ISSUED_BY_UNIVERSITY',
          type: docType,
          title: service.nameRu,
          number: appNumber,
          numberLast4: last4Of(appNumber),
          issuedAt,
          issuedByUniversity: true,
          status: revoke ? 'REJECTED' : 'UPLOADED',
          rejectionReason: revoke ? REVOKED_REASON : null,
          createdAt: issuedAt,
        })
        const sample = nextPdf()
        if (sample) {
          resultFiles.push(
            formatFileRow(sample, scanNo++, {
              id: child(documentId, 'p', 0),
              ownerId: staffId,
              documentId,
              order: 0,
              createdAt: issuedAt,
            }),
          )
        }
        await writer.add('documentEvent', {
          id: child(documentId, 'ev', 'up'),
          documentId,
          actorId: staffId,
          action: 'UPLOAD',
          metadata: { issuedTo: studentId },
          createdAt: issuedAt,
        })
        if (revoke) {
          await writer.add('documentEvent', {
            id: child(documentId, 'ev', 'revoke'),
            documentId,
            actorId: staffId,
            action: 'REJECT',
            metadata: { reason: REVOKED_REASON, revoked: true, viaApplication: applicationId },
            createdAt: when('RESULT_REVOKED'),
          })
        }
      }
      await writer.add('applicationResult', {
        id: child(applicationId, 'res'),
        applicationId,
        type,
        documentId,
        documentNumber: type === 'ELECTRONIC_DOCUMENT' ? appNumber : null,
        note: note ?? 'Документ доступен для скачивания в разделе «Документы».',
        issuedById: staffId,
        createdAt: when('RESULT_ADDED'),
      })
    }
    if (paperResult) {
      await writer.add('applicationResult', {
        id: child(applicationId, 'res', 'paper'),
        applicationId,
        type: 'PAPER_DOCUMENT',
        documentId: null,
        documentNumber: `${uniId}-R${String(no).padStart(6, '0')}`,
        note: 'Оригинал выдан в деканате.',
        issuedById: staffId,
        createdAt: when('ISSUED'),
      })
    }
  }
  await writer.flush()
  await writer.addMany('file', resultFiles.splice(0))
  await writer.flush()

  // ── Жалобы: очередь модерации вуза ──────────────────────────────────────────
  // Цель — настоящий объект своего типа: жалоба на комментарий указывает на комментарий,
  // на сообщение — на сообщение личного диалога, а жалуется его собеседник. Раньше
  // COMMENT и MESSAGE указывали на id поста — карточка жалобы не находила цель.
  const uniPostIds = Array.from({ length: 8 }, (_, pi) => id(index, 'post', 'uni', pi))
  const comments = await prisma.comment.findMany({
    where: { postId: { in: uniPostIds }, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 12,
  })
  // Первое сообщение диалога pv-0 (шаг 60) пишет studentIds[0], собеседник — studentIds[1].
  const dialogs = people.faculties
    .flatMap((f) => f.groups)
    .filter((g) => g.studentIds.length >= 2)
    .map((g) => ({
      messageId: child(child(g.id, 'chat', 'pv', 0), 'msg', 1),
      peerId: g.studentIds[1],
    }))
  // Статусы — по кругу, а не случайно: на маленьком вузе «на рассмотрении» или «отклонена»
  // иначе могли не выпасть вовсе.
  const COMPLAINT_STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'PENDING', 'DISMISSED', 'RESOLVED'] // prettier-ignore
  for (let ci = 0; ci < 12; ci += 1) {
    let reporterId = allStudents[(ci * 37) % allStudents.length]
    let targetType = ['POST', 'COMMENT', 'MESSAGE', 'USER'][ci % 4]
    let targetId = id(index, 'post', 'uni', ci % 8)
    if (targetType === 'USER') targetId = allStudents[(ci * 11) % allStudents.length]
    if (targetType === 'COMMENT') {
      const comment = comments[ci % Math.max(comments.length, 1)]
      // Комментариев у постов вуза может не оказаться (их число случайно) — тогда жалоба
      // на сам пост, а не на несуществующий комментарий.
      if (comment) targetId = comment.id
      else targetType = 'POST'
    }
    if (targetType === 'MESSAGE') {
      const dialog = dialogs[ci % Math.max(dialogs.length, 1)]
      if (dialog) {
        targetId = dialog.messageId
        reporterId = dialog.peerId
      } else targetType = 'POST'
    }
    const status = COMPLAINT_STATUSES[ci % COMPLAINT_STATUSES.length]
    const closed = status === 'RESOLVED' || status === 'DISMISSED'
    await writer.add('complaint', {
      id: id(index, 'cmp', ci),
      reporterId,
      targetType,
      targetId,
      reason: random.pick(COMPLAINT_REASONS),
      status,
      priority: PRIORITY_BY_TARGET[targetType],
      universityId: uniId,
      resolvedById: closed ? people.moderatorIds[ci % people.moderatorIds.length] : null,
      resolution: closed ? (status === 'RESOLVED' ? 'Контент удалён, автору выдано предупреждение' : 'Нарушения не найдено') : null, // prettier-ignore
      resolvedAt: closed ? random.randomDate(-10, -1) : null,
      createdAt: random.randomDate(-30, -1),
    })
  }

  // ── Уведомления: у каждого пользователя вуза ────────────────────────────────
  // Фон ленты. Каждый вид уведомления, который шлёт API (словарь notification-messages),
  // добавляет шаг 76-coverage — со своими ключами и параметрами.
  const everyone = [
    people.adminId,
    ...people.moderatorIds,
    ...people.faculties.flatMap((f) => [f.deanId, ...f.teacherIds]),
    ...allStudents,
  ]
  for (const userId of everyone) {
    const count = random.randInt(2, 5)
    for (let ni = 0; ni < count; ni += 1) {
      const [type, title, body] = NOTIFICATIONS[(ni + userId.length) % NOTIFICATIONS.length]
      const isRead = random.chance(0.55)
      const createdAt = random.randomDate(-20, 0)
      await writer.add('notification', {
        id: child(userId, 'ntf', ni),
        userId,
        type,
        title,
        body,
        data: { source: 'seed' },
        isRead,
        readAt: isRead ? createdAt : null,
        // Ключ идемпотентности уникален в пределах пользователя (как у процессора очереди).
        dedupeKey: `seed:${type}:${ni}`,
        createdAt,
      })
    }
  }
  await writer.flush()

  // ── Журнал документов: остальные действия и пути доступа ────────────────────
  await seedDocumentJournal(prisma, writer, { ...ctx, allStudents })
  await writer.flush()
}
