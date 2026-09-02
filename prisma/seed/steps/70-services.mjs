// Шаг «документы и услуги»: личные и выданные вузом документы с доступами и журналом,
// типы документов вуза, запрос комплекта и ответы студентов, заявки на услуги со
// всеми статусами, жалобы, уведомления и журнал аудита.
//
// Документы намеренно живут метаданными: файлы-сканы существуют только у части
// документов (объектов в пуле конечное число, см. шаг 10), а списки, обзор, доступы
// и запросы работают и без содержимого.
//
// Каталог услуг глобальный (universityId = null, его создаёт основной сид), поэтому
// заявки ссылаются на него; плюс на каждый вуз создаётся своя услуга — чтобы путь
// «услуга вуза», а не только «шаблон платформы», тоже был покрыт.

import { child, id } from '../lib/ids.mjs'

const DOC_TEMPLATES = [
  // [type, category, статус, срок действия в днях от сегодня (null — бессрочно)]
  ['ID_CARD', 'PERSONAL', 'ACCEPTED', 900],
  ['PASSPORT', 'PERSONAL', 'VERIFIED', 1600],
  ['SCHOOL_CERTIFICATE', 'ACADEMIC', 'ACCEPTED', null],
  ['MEDICAL', 'CERTIFICATE', 'UPLOADED', 12],
  ['STUDY_PLACE', 'CERTIFICATE', 'IN_REVIEW', 45],
  ['MILITARY_DOCS', 'CERTIFICATE', 'DRAFT', null],
  ['SOCIAL_REFERENCE', 'CERTIFICATE', 'REJECTED', -20],
  ['BENEFITS_DOCS', 'CERTIFICATE', 'NEEDS_REPLACEMENT', -5],
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
// Типы документов, включённые вузом (id из каталога packages/shared-config/documents.ts).
const ENABLED_TYPES = ['ID_CARD','PASSPORT','SCHOOL_CERTIFICATE','DIPLOMA','TRANSCRIPT','MEDICAL','STUDY_PLACE','MILITARY_DOCS','SOCIAL_REFERENCE','STUDENT_ID','ENROLLMENT_ORDER','CAMPUS_PASS'] // prettier-ignore

// Глобальные услуги основного сида: на них ссылаются заявки.
const GLOBAL_SERVICES = [
  { id: 'seed-appsvc-study-certificate', requirement: 'seed-appreq-study-certificate-id-card', sla: 8 }, // prettier-ignore
  { id: 'seed-appsvc-transcript', requirement: 'seed-appreq-transcript-id-card', sla: 48 },
  { id: 'seed-appsvc-academic-leave', requirement: 'seed-appreq-academic-leave-id-card', sla: 120 },
]

// Статусы заявки и их «геометрия»: какие даты заполнены и что в журнале.
// Статусы — строго из APPLICATION_STATUSES (packages/shared-schemas/applications.ts).
// CANCELLED там НЕТ: отмена — это поле cancelledAt, а не отдельный статус.
const APP_FLOWS = [
  ['DRAFT', 18],
  ['SUBMITTED', 18],
  ['IN_REVIEW', 14],
  ['NEEDS_CORRECTION', 8],
  ['IN_PREPARATION', 8],
  ['READY', 12],
  ['READY_FOR_PICKUP', 6],
  ['ISSUED', 10],
  ['DELIVERED', 3],
  ['REJECTED', 3],
]

const COMPLAINT_REASONS = [
  'Спам в комментариях',
  'Оскорбление в личных сообщениях',
  'Недостоверная информация в посте',
  'Реклама сторонних услуг',
  'Нарушение правил сообщества',
]
const NOTIFICATIONS = [
  ['SCHEDULE_CHANGE', 'Изменение в расписании', 'Пара по расписанию перенесена. Проверьте раздел «Изменения».'], // prettier-ignore
  ['APP_UPDATE', 'Статус заявки изменён', 'Ваша заявка перешла в статус «Готово».'],
  ['MESSAGE', 'Новое сообщение', 'Вам написали в чате группы.'],
  ['POST', 'Новое объявление', 'Опубликовано объявление деканата.'],
  ['EVENT', 'Скоро событие', 'Мероприятие начнётся через час.'],
  ['SYSTEM', 'Добро пожаловать', 'Профиль создан. Заполните раздел «Портфолио».'],
]

export async function seedServices(prisma, writer, ctx) {
  const { index, random, structure, people } = ctx
  const { uniId } = structure
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))

  // ── Типы документов вуза (включённые + один свой) ───────────────────────────
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

  // ── Своя услуга вуза + требование и поле формы ──────────────────────────────
  const ownServiceId = id(index, 'svc', 'dorm')
  await writer.add('applicationService', {
    id: ownServiceId,
    categoryId: 'seed-appcat-dormitory',
    universityId: uniId,
    code: 'dormitory-place',
    nameRu: 'Место в общежитии',
    nameKk: 'Жатақханадан орын',
    nameEn: 'Dormitory place',
    descriptionRu: 'Заявление на предоставление места в студенческом общежитии.',
    slaHours: 72,
    deliveryModes: ['ELECTRONIC'],
    facultyScoped: true,
    sortOrder: 10,
  })
  const ownRequirementId = child(ownServiceId, 'req', 'id-card')
  await writer.add('serviceRequirement', {
    id: ownRequirementId,
    serviceId: ownServiceId,
    code: 'id-card',
    documentType: 'ID_CARD',
    titleRu: 'Удостоверение личности',
    titleKk: 'Жеке куәлік',
    titleEn: 'ID card',
    required: true,
    sortOrder: 1,
  })
  await writer.add('serviceFormField', {
    id: child(ownServiceId, 'fld', 'family'),
    serviceId: ownServiceId,
    code: 'family-status',
    type: 'SELECT',
    labelRu: 'Основание',
    labelKk: 'Негіздеме',
    labelEn: 'Grounds',
    required: true,
    options: [
      { value: 'far', labelRu: 'Иногородний' },
      { value: 'social', labelRu: 'Социальная категория' },
    ],
    sortOrder: 1,
  })
  await writer.flush()

  // ── Документы студентов: у всех, по 5–8 позиций + выданные вузом ────────────
  // Набор у каждого свой, поэтому запоминаем, какие типы реально созданы: ответ на
  // запрос вуза ссылается на документ по FK, и «предположить», что он есть, нельзя.
  const docTypesByStudent = new Map()
  for (const [si, studentId] of allStudents.entries()) {
    const take = random.randInt(5, DOC_TEMPLATES.length)
    docTypesByStudent.set(studentId, new Set(DOC_TEMPLATES.slice(0, take).map(([t]) => t)))
    for (let i = 0; i < take; i += 1) {
      const [type, category, status, expiresIn] = DOC_TEMPLATES[i]
      const documentId = child(studentId, 'doc', type)
      const archived = status === 'ACCEPTED' && random.chance(0.1)
      const last4 = String(1000 + random.randInt(0, 8999))
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
        rejectionReason: status === 'REJECTED' ? 'Скан нечитаемый — переснимите документ' : null,
        archivedAt: archived ? random.randomDate(-120, -10) : null,
        createdAt: random.randomDate(-400, -5),
      })
      await writer.add('documentEvent', {
        id: child(documentId, 'ev', 'up'),
        documentId,
        actorId: studentId,
        action: 'UPLOAD',
        createdAt: random.randomDate(-400, -5),
      })
      // Доступы: активные, отозванные и просроченные — все три состояния должны
      // встречаться на экране «Управление доступом».
      if (i < 2 && random.chance(0.6)) {
        const expired = random.chance(0.35)
        const revoked = !expired && random.chance(0.25)
        const toFaculty = random.chance(0.4)
        await writer.add('documentAccess', {
          id: child(documentId, 'acc'),
          documentId,
          granteeType: toFaculty ? 'DEPARTMENT' : 'UNIVERSITY',
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
          createdAt: random.randomDate(-300, -30),
        })
      }
    }
    // Выданные вузом.
    for (const type of ['STUDENT_ID', 'ENROLLMENT_ORDER', 'STUDY_CONTRACT']) {
      const documentId = child(studentId, 'doc', type)
      const last4 = String(1000 + random.randInt(0, 8999))
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
        issuedAt: random.randomDate(-1000, -100),
        status: 'ACCEPTED',
        issuedByUniversity: true,
      })
    }
  }
  await writer.flush()

  // ── Запрос комплекта документов + ответы студентов ──────────────────────────
  const requestId = id(index, 'docreq')
  const requestAuthor = people.faculties[0].deanId
  await writer.add('documentRequest', {
    id: requestId,
    universityId: uniId,
    createdById: requestAuthor,
    title: 'Комплект документов на новый учебный год',
    description: 'Загрузите действующие документы до начала сессии.',
    dueAt: random.daysFromNow(21),
    status: 'OPEN',
  })
  const requestItems = [
    ['ID_CARD', 'Удостоверение личности', true],
    ['MEDICAL', 'Медицинская справка 086-У', true],
    ['SOCIAL_REFERENCE', 'Справка о составе семьи', false],
  ]
  for (const [ri, [documentType, title, required]] of requestItems.entries()) {
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
  await writer.flush()

  // Ответы: часть отправлена и проверена, часть в черновике — на экране сотрудника
  // должны быть видны все стадии.
  for (const [si, studentId] of allStudents.entries()) {
    const sent = si % 3 !== 2
    const accepted = si % 4 === 0
    const submissionId = child(studentId, 'docsub')
    await writer.add('documentSubmission', {
      id: submissionId,
      requestId,
      studentId,
      status: sent ? (accepted ? 'ACCEPTED' : 'SUBMITTED') : 'DRAFT',
      submittedAt: sent ? random.randomDate(-10, -1) : null,
      reviewedById: accepted ? requestAuthor : null,
      reviewedAt: accepted ? random.randomDate(-5, 0) : null,
    })
    for (const [ri, [documentType]] of requestItems.entries()) {
      const documentId = child(studentId, 'doc', documentType)
      await writer.add('documentSubmissionItem', {
        id: child(submissionId, 'it', ri),
        submissionId,
        requestItemId: child(requestId, 'it', ri),
        // Документ может отсутствовать (набор у каждого свой) — тогда позиция пустая.
        documentId: docTypesByStudent.get(studentId)?.has(documentType) ? documentId : null,
        status: accepted ? 'ACCEPTED' : 'PENDING',
        reviewedById: accepted ? requestAuthor : null,
        reviewedAt: accepted ? random.randomDate(-5, 0) : null,
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

  for (const [si, { studentId, faculty, no }] of flatStudents.entries()) {
    const status = random.pickWeighted(APP_FLOWS)
    const useOwn = random.chance(0.3)
    const service = useOwn ? null : GLOBAL_SERVICES[si % GLOBAL_SERVICES.length]
    const serviceId = useOwn ? ownServiceId : service.id
    const requirementId = useOwn ? ownRequirementId : service.requirement
    const slaHours = useOwn ? 72 : service.sla

    const applicationId = child(studentId, 'app')
    const appNo = no
    const submitted = status !== 'DRAFT' ? random.randomDate(-20, -1) : null
    const isReady = ['READY', 'READY_FOR_PICKUP', 'ISSUED', 'DELIVERED'].includes(status)
    const isIssued = status === 'ISSUED' || status === 'DELIVERED'
    await writer.add('application', {
      id: applicationId,
      // Номер уникален глобально — поэтому с префиксом вуза.
      number: status === 'DRAFT' ? null : `${uniId}-${String(appNo).padStart(6, '0')}`,
      studentId,
      universityId: uniId,
      facultyId: faculty.id,
      serviceId,
      status,
      deliveryType: 'ELECTRONIC',
      formData: { purpose: 'по месту требования' },
      assignedToId: status === 'DRAFT' || status === 'SUBMITTED' ? null : faculty.deanId,
      assignedAt: status === 'DRAFT' || status === 'SUBMITTED' ? null : random.randomDate(-15, -1),
      submittedAt: submitted,
      startedAt: status === 'DRAFT' || status === 'SUBMITTED' ? null : random.randomDate(-14, -1),
      // Срок по SLA от подачи — так на экране очереди видно и просрочку, и запас.
      dueAt: submitted ? new Date(submitted.getTime() + slaHours * 3_600_000) : null,
      readyAt: isReady ? random.randomDate(-7, -1) : null,
      issuedAt: isIssued ? random.randomDate(-6, 0) : null,
      issuedById: isIssued ? faculty.deanId : null,
      rejectionReason:
        status === 'REJECTED'
          ? 'Приложен нечитаемый скан документа'
          : status === 'NEEDS_CORRECTION'
            ? 'Уточните место требования справки'
            : null,
      pickupCode:
        status === 'READY_FOR_PICKUP' || isIssued
          ? `${uniId}-P${String(appNo).padStart(6, '0')}`
          : null,
      pickupLocation: status === 'READY_FOR_PICKUP' ? 'Деканат, кабинет 210' : null,
      pickupInstructions:
        status === 'READY_FOR_PICKUP' ? 'Возьмите с собой удостоверение личности.' : null,
      createdAt: submitted ?? random.randomDate(-25, -1),
    })

    // Журнал переходов: создание → подача → (взято в работу) → финал.
    const events = [['CREATED', null, 'DRAFT']]
    if (status !== 'DRAFT') events.push(['SUBMITTED', 'DRAFT', 'SUBMITTED'])
    if (status !== 'DRAFT' && status !== 'SUBMITTED') {
      events.push(['ASSIGNED', 'SUBMITTED', 'IN_REVIEW'])
    }
    if (status === 'NEEDS_CORRECTION') events.push(['CORRECTION_REQUESTED', 'IN_REVIEW', 'NEEDS_CORRECTION']) // prettier-ignore
    if (status === 'IN_PREPARATION') events.push(['PREPARATION', 'IN_REVIEW', 'IN_PREPARATION'])
    if (isReady) events.push(['READY', 'IN_REVIEW', 'READY'])
    if (status === 'READY_FOR_PICKUP') events.push(['PICKUP_READY', 'READY', 'READY_FOR_PICKUP'])
    if (isIssued) events.push(['ISSUED', 'READY', 'ISSUED'])
    if (status === 'DELIVERED') events.push(['DELIVERED', 'ISSUED', 'DELIVERED'])
    if (status === 'REJECTED') events.push(['REJECTED', 'IN_REVIEW', 'REJECTED'])
    for (const [ei, [action, fromStatus, toStatus]] of events.entries()) {
      await writer.add('applicationEvent', {
        id: child(applicationId, 'ev', ei),
        applicationId,
        actorId: ei === 0 ? studentId : faculty.deanId,
        action,
        fromStatus,
        toStatus,
        createdAt: random.randomDate(-20 + ei, -1),
      })
    }

    // Приложенный документ из хранилища.
    if (status !== 'DRAFT') {
      await writer.add('applicationDocument', {
        id: child(applicationId, 'doc'),
        applicationId,
        requirementId,
        documentId: child(studentId, 'doc', 'ID_CARD'),
        source: 'STORAGE',
        status: isReady ? 'ACCEPTED' : status === 'NEEDS_CORRECTION' ? 'REPLACEMENT_REQUIRED' : 'PENDING', // prettier-ignore
        reviewComment: status === 'NEEDS_CORRECTION' ? 'Приложите разворот с фотографией' : null,
        snapshotTitle: 'Удостоверение личности',
        reviewedById: isReady ? faculty.deanId : null,
        reviewedAt: isReady ? random.randomDate(-7, -1) : null,
      })
    }
    // Результат: выданная вузом электронная справка.
    if (isIssued) {
      await writer.add('applicationResult', {
        id: child(applicationId, 'res'),
        applicationId,
        type: 'DOCUMENT',
        documentId: child(studentId, 'doc', 'STUDENT_ID'),
        documentNumber: `${uniId}-R${String(appNo).padStart(6, '0')}`,
        note: 'Документ доступен для скачивания в разделе «Документы».',
        issuedById: faculty.deanId,
      })
    }
  }
  await writer.flush()

  // ── Жалобы: очередь модерации вуза ──────────────────────────────────────────
  for (let ci = 0; ci < 12; ci += 1) {
    const reporterId = allStudents[(ci * 37) % allStudents.length]
    const targetType = ['POST', 'COMMENT', 'MESSAGE', 'USER'][ci % 4]
    const status = random.pickWeighted([
      ['PENDING', 40],
      ['REVIEWING', 20],
      ['RESOLVED', 30],
      ['DISMISSED', 10],
    ])
    const closed = status === 'RESOLVED' || status === 'DISMISSED'
    await writer.add('complaint', {
      id: id(index, 'cmp', ci),
      reporterId,
      targetType,
      // Цель — реальный объект: пост вуза либо пользователь.
      targetId: targetType === 'USER' ? allStudents[(ci * 11) % allStudents.length] : id(index, 'post', 'uni', ci % 8), // prettier-ignore
      reason: random.pick(COMPLAINT_REASONS),
      status,
      // Приоритет по категории цели (жалобы на человека и личные сообщения — первыми).
      priority: targetType === 'USER' || targetType === 'MESSAGE' ? 'HIGH' : 'MEDIUM',
      universityId: uniId,
      resolvedById: closed ? people.moderatorIds[ci % people.moderatorIds.length] : null,
      resolution: closed ? (status === 'RESOLVED' ? 'Контент удалён, автору выдано предупреждение' : 'Нарушения не найдено') : null, // prettier-ignore
      resolvedAt: closed ? random.randomDate(-10, -1) : null,
      createdAt: random.randomDate(-30, -1),
    })
  }

  // ── Уведомления: у каждого пользователя вуза ────────────────────────────────
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

  // ── Журнал аудита: вход, инвайты, работа с документами ──────────────────────
  const auditActions = [
    ['USER_LOGIN', 'User'],
    ['INVITE_CREATED', 'Invite'],
    ['DOCUMENT_VIEW', 'Document'],
    ['APPLICATION_STATUS_CHANGED', 'Application'],
    ['COMPLAINT_RESOLVED', 'Complaint'],
  ]
  for (const [ai, [action, entity]] of auditActions.entries()) {
    await writer.add('auditLog', {
      id: id(index, 'audit', ai),
      userId: people.adminId,
      action,
      entity,
      entityId: uniId,
      metadata: { seed: true },
      ip: `10.${index % 255}.0.${ai + 1}`,
      userAgent: 'Mozilla/5.0 (seed)',
      createdAt: random.randomDate(-30, 0),
    })
  }

  await writer.flush()
}
