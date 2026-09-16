// Шаг «каталог услуг»: категории и ГЛОБАЛЬНЫЕ шаблоны услуг платформы.
//
// Справочник, а не демо-данные: шаблоны с `universityId = null` видны всем вузам, и
// заявки студентов ссылаются именно на них (см. steps/70-services.mjs). Поэтому шаг
// обязателен в любом профиле сида — в том числе там, где демо-вуза нет вовсе.
//
// Жил внутри prisma/seed.mjs между демо-структурой и большим демо-датасетом. Вынесен
// отдельным шагом, когда появился профиль test: там демо-вуз не заливается, а каталог
// нужен по-прежнему.
//
// Идемпотентно: фиксированные id + upsert.

export async function seedServiceCatalog(prisma) {
  // ── Каталог услуг (переработка «Заявок»): категории + базовые глобальные услуги ──
  // Идемпотентно по фиксированным id. Глобальные шаблоны (universityId = null) видны всем вузам.
  const categories = [
    ['ACADEMIC', 'Учебные', 'Оқу', 'Academic', 1],
    ['CERTIFICATES', 'Справки', 'Анықтамалар', 'Certificates', 2],
    ['FINANCIAL', 'Финансы', 'Қаржы', 'Financial', 3],
    ['MILITARY', 'Воинский учёт', 'Әскери есеп', 'Military', 4],
    ['DORMITORY', 'Общежитие', 'Жатақхана', 'Dormitory', 5],
    ['PERSONAL_DATA', 'Личные данные', 'Жеке деректер', 'Personal data', 6],
    ['TECHNICAL', 'Технические', 'Техникалық', 'Technical', 7],
    ['OTHER', 'Прочее', 'Басқа', 'Other', 8],
  ]
  const catId = {}
  for (const [code, nameRu, nameKk, nameEn, sortOrder] of categories) {
    const id = `seed-appcat-${code.toLowerCase()}`
    catId[code] = id
    await prisma.applicationCategory.upsert({
      where: { id },
      update: { nameRu, nameKk, nameEn, sortOrder },
      create: { id, code, nameRu, nameKk, nameEn, sortOrder },
    })
  }

  // Услуга + её требования (документы) + поля формы. slaHours — простой SLA.
  const services = [
    {
      code: 'study-certificate',
      category: 'CERTIFICATES',
      nameRu: 'Справка с места обучения',
      nameKk: 'Оқу орнынан анықтама',
      nameEn: 'Certificate of study',
      descriptionRu: 'Справка, подтверждающая обучение в университете.',
      slaHours: 8,
      deliveryModes: ['ELECTRONIC', 'PAPER'],
      requirements: [
        ['id-card', 'ID_CARD', 'Удостоверение личности', 'Жеке куәлік', 'ID card', true],
      ],
      formFields: [
        {
          code: 'purpose',
          type: 'TEXT',
          labelRu: 'Место требования',
          labelKk: 'Талап ету орны',
          labelEn: 'Place of demand',
          required: false,
        },
      ],
    },
    {
      code: 'transcript',
      category: 'ACADEMIC',
      nameRu: 'Транскрипт',
      nameKk: 'Транскрипт',
      nameEn: 'Transcript',
      descriptionRu: 'Выписка об академической успеваемости.',
      slaHours: 48,
      deliveryModes: ['ELECTRONIC', 'PAPER'],
      requirements: [
        ['id-card', 'ID_CARD', 'Удостоверение личности', 'Жеке куәлік', 'ID card', true],
      ],
      formFields: [],
    },
    {
      code: 'academic-leave',
      category: 'ACADEMIC',
      nameRu: 'Академический отпуск',
      nameKk: 'Академиялық демалыс',
      nameEn: 'Academic leave',
      descriptionRu: 'Оформление академического отпуска.',
      slaHours: 120,
      deliveryModes: ['PAPER'],
      requiresPickup: true,
      requirements: [
        ['statement', 'STATEMENT', 'Заявление', 'Өтініш', 'Statement', true],
        ['medical', 'MEDICAL', 'Медицинское заключение', 'Медициналық қорытынды', 'Medical report', true], // prettier-ignore
        ['id-card', 'ID_CARD', 'Удостоверение личности', 'Жеке куәлік', 'ID card', true],
      ],
      formFields: [
        {
          code: 'reason',
          type: 'TEXTAREA',
          labelRu: 'Причина',
          labelKk: 'Себебі',
          labelEn: 'Reason',
          required: true,
        },
      ],
    },
  ]
  for (const [i, s] of services.entries()) {
    const id = `seed-appsvc-${s.code}`
    await prisma.applicationService.upsert({
      where: { id },
      update: { nameRu: s.nameRu, nameKk: s.nameKk, nameEn: s.nameEn, sortOrder: i + 1 },
      create: {
        id,
        categoryId: catId[s.category],
        code: s.code,
        nameRu: s.nameRu,
        nameKk: s.nameKk,
        nameEn: s.nameEn,
        descriptionRu: s.descriptionRu,
        slaHours: s.slaHours,
        deliveryModes: s.deliveryModes,
        requiresPickup: s.requiresPickup ?? false,
        sortOrder: i + 1,
      },
    })
    for (const [j, r] of (s.requirements ?? []).entries()) {
      const [rcode, docType, titleRu, titleKk, titleEn, required] = r
      const rid = `seed-appreq-${s.code}-${rcode}`
      await prisma.serviceRequirement.upsert({
        where: { id: rid },
        update: { titleRu, titleKk, titleEn, required, sortOrder: j + 1 },
        create: {
          id: rid,
          serviceId: id,
          code: rcode,
          documentType: docType,
          titleRu,
          titleKk,
          titleEn,
          required,
          sortOrder: j + 1,
        },
      })
    }
    for (const [j, f] of (s.formFields ?? []).entries()) {
      const fid = `seed-appfld-${s.code}-${f.code}`
      await prisma.serviceFormField.upsert({
        where: { id: fid },
        update: { labelRu: f.labelRu, labelKk: f.labelKk, labelEn: f.labelEn, sortOrder: j + 1 },
        create: {
          id: fid,
          serviceId: id,
          code: f.code,
          type: f.type,
          labelRu: f.labelRu,
          labelKk: f.labelKk,
          labelEn: f.labelEn,
          required: f.required ?? false,
          sortOrder: j + 1,
        },
      })
    }
  }
}
