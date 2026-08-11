// Идемпотентный seed (docs/PROJECT.md §14): PLATFORM_ADMIN, демо-вуз/факультет/группа/
// аудитории (Фаза 5) и dev-инвайт для UNIVERSITY_ADMIN на этот вуз.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Dev-инвайт: фиксированный токен, срок 30 дней (dev-only, резолюция §19.2). В проде отзывается после первого использования.
const DEV_INVITE_TOKEN = 'seed-invite-university-admin-token'
const SEED_UNIVERSITY_ID = 'seed-university-001'

async function main() {
  const passwordHash = await bcrypt.hash('Admin1234!', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@studenthub.app' },
    update: {}, // не перезаписываем пароль/профиль при повторном запуске
    create: {
      email: 'admin@studenthub.app',
      passwordHash,
      firstName: 'Платформенный',
      lastName: 'Администратор',
      role: 'PLATFORM_ADMIN',
    },
  })

  // Демо-структура (Фаза 5): вуз ACTIVE, факультет, группа, 3 аудитории.
  const university = await prisma.university.upsert({
    where: { id: SEED_UNIVERSITY_ID },
    update: {},
    create: {
      id: SEED_UNIVERSITY_ID,
      name: 'Демонстрационный университет',
      shortName: 'ДемоВУЗ',
      status: 'ACTIVE',
      country: 'Казахстан',
      city: 'Алматы',
    },
  })

  const faculty = await prisma.faculty.upsert({
    where: { id: 'seed-faculty-001' },
    update: {},
    create: {
      id: 'seed-faculty-001',
      name: 'Факультет информационных технологий',
      universityId: university.id,
    },
  })

  await prisma.group.upsert({
    where: { id: 'seed-group-001' },
    update: {},
    create: { id: 'seed-group-001', name: 'ИТ-23-1', year: 2023, facultyId: faculty.id },
  })

  const rooms = [
    ['seed-room-101', '101', 30],
    ['seed-room-102', '102', 50],
    ['seed-room-103', 'Лаборатория A', 20],
  ]
  for (const [id, name, capacity] of rooms) {
    await prisma.room.upsert({
      where: { id },
      update: {},
      create: { id, name, capacity, universityId: university.id },
    })
  }

  await prisma.invite.upsert({
    where: { token: DEV_INVITE_TOKEN },
    update: {},
    create: {
      token: DEV_INVITE_TOKEN,
      role: 'UNIVERSITY_ADMIN',
      email: 'university-admin@demo.studenthub.app',
      universityId: SEED_UNIVERSITY_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      createdById: admin.id,
    },
  })

  // Dev-пользователи по всем ролям (кроме PLATFORM_ADMIN — он выше). Все с паролем
  // Admin1234!, привязаны к демо-скоупу. Идемпотентно (upsert по email, update:{} —
  // повторный запуск не трогает пароль/профиль). Только для dev/демо — в проде сменить/удалить.
  const scope = {
    university: { universityId: SEED_UNIVERSITY_ID },
    faculty: { universityId: SEED_UNIVERSITY_ID, facultyId: faculty.id },
    group: { universityId: SEED_UNIVERSITY_ID, facultyId: faculty.id, groupId: 'seed-group-001' },
  }
  // Реалистичные имена: роль показывается отдельным бейджем, поэтому имя-плейсхолдер
  // из слов роли («Декан Факультета») читалось некорректно в любом порядке — заменено.
  const devUsers = [
    ['PLATFORM_MODERATOR', 'platform-moderator@studenthub.app', 'Марат', 'Сулейменов', {}],
    [
      'UNIVERSITY_ADMIN',
      'university-admin@studenthub.app',
      'Айгуль',
      'Нурланова',
      scope.university,
    ],
    ['UNIVERSITY_MODERATOR', 'university-moderator@studenthub.app', 'Тимур', 'Байжанов', scope.university], // prettier-ignore
    ['DEAN', 'dean@studenthub.app', 'Дамир', 'Ахметов', scope.faculty],
    ['TEACHER', 'teacher@studenthub.app', 'Елена', 'Иванова', scope.faculty],
    ['STAROSTA', 'starosta@studenthub.app', 'Аружан', 'Серикова', scope.group],
    ['STUDENT', 'student@studenthub.app', 'Нурлан', 'Оспанов', scope.group],
  ]
  for (const [role, email, firstName, lastName, userScope] of devUsers) {
    await prisma.user.upsert({
      where: { email },
      // Синхронизируем имя на существующих dev-аккаунтах (иначе старые плейсхолдеры остаются).
      update: { firstName, lastName },
      create: { email, passwordHash, firstName, lastName, role, ...userScope },
    })
  }

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

  console.log('Seed готов:')
  console.log('  PLATFORM_ADMIN: admin@studenthub.app / Admin1234!  (сменить сразу)')
  console.log('  Пользователи по ролям (пароль у всех Admin1234!):')
  for (const [role, email] of devUsers) {
    console.log(`    ${role}: ${email}`)
  }
  console.log(
    '  Демо-вуз: Демонстрационный университет (ACTIVE) + факультет ИТ + группа ИТ-23-1 + 3 аудитории',
  )
  console.log(`  dev-инвайт UNIVERSITY_ADMIN: /register?token=${DEV_INVITE_TOKEN}`)
}

main()
  .catch((error) => {
    console.error('Seed упал:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
