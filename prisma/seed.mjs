// Идемпотентный seed (docs/PROJECT.md §14): PLATFORM_ADMIN, демо-вуз/факультет/группа/
// аудитории (Фаза 5) и dev-инвайт для UNIVERSITY_ADMIN на этот вуз.
//
// Масштаб задаётся профилем SEED_SCALE (prisma/seed/config.mjs):
//   demo (по умолчанию) — этот демо-вуз, как раньше;
//   small / full        — 5 / 100 вузов (генератор подключается следующими шагами).
// Полный масштаб на нелокальной БД заблокирован без SEED_ALLOW_REMOTE=1.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { loadConfig } from './seed/config.mjs'
import { makeRandom } from './seed/lib/rng.mjs'
import { createProgress } from './seed/lib/progress.mjs'
import { seedUniversities } from './seed/index.mjs'
import { seedKato } from './seed/steps/00-kato.mjs'
import { seedMedia } from './seed/steps/10-media.mjs'
import { seedCompanies } from './seed/steps/15-companies.mjs'
import { seedDemoExtras } from './seed/steps/90-demo-extras.mjs'
import { createWriter } from './seed/lib/writer.mjs'
import { createStorage } from './seed/lib/storage.mjs'

const prisma = new PrismaClient()
const config = loadConfig()

// Dev-инвайт: фиксированный токен, срок 30 дней (dev-only, резолюция §19.2). В проде отзывается после первого использования.
const DEV_INVITE_TOKEN = 'seed-invite-university-admin-token'
const SEED_UNIVERSITY_ID = 'seed-university-001'
const ALMATY_KATO_CODE = '750000000'

// ── Утилиты для большого реалистичного seed'а ────────────────────────────────
// PRNG и хелперы выборки — из prisma/seed/lib/rng.mjs (общие с генератором вузов).
// Зерно 20260812 оставлено историческим: демо-данные должны остаться теми же, иначе
// у существующих строк поменялись бы значения при том же id.
const { rng, pick, randInt, chance, daysFromNow } = makeRandom(20260812)

// Глубина истории посещаемости: столько же, сколько окно тренда на дашборде вуза
// (12 недель ≈ семестр). Меньше — и график динамики нечем наполнить.
const ATT_WEEKS = 12

// Пулы имён (казахские/русские). Женские фамилии образуем добавлением «а» к мужским (‑ов/‑ев).
const MALE_NAMES = ['Нурлан','Алихан','Дамир','Ерасыл','Санжар','Арман','Тимур','Азамат','Ислам','Бекзат','Данияр','Ержан','Мирас','Диас','Аскар','Ринат','Куаныш','Олжас','Темирлан','Нурсултан','Абылай','Даулет','Мадияр','Асылбек'] // prettier-ignore
const FEMALE_NAMES = ['Аружан','Айгерим','Дана','Мадина','Аяжан','Камила','Дильназ','Асем','Жания','Алина','Сабина','Нургуль','Динара','Балжан','Гаухар','Лаура','Инжу','Томирис','Айым','Молдир','Жансая','Карина','Аяулым','Сауле'] // prettier-ignore
const SURNAMES_M = ['Оспанов','Ахметов','Байжанов','Сулейменов','Ермеков','Калиев','Нургалиев','Тлеубаев','Жумабеков','Абишев','Сериков','Досанов','Кенжебаев','Мухамеджанов','Искаков','Оразбаев','Бектуров','Садыков','Алимбаев','Турсунов','Кабдулов','Нуркенов','Сапаров','Утегенов'] // prettier-ignore

function person(i) {
  const female = i % 2 === 0
  const first = female ? pick(FEMALE_NAMES) : pick(MALE_NAMES)
  const surM = pick(SURNAMES_M)
  const last = female ? `${surM}а` : surM
  return { firstName: first, lastName: last, gender: female ? 'FEMALE' : 'MALE' }
}

// Пакетная вставка чанками (SEED_CHUNK) — устойчиво к большим объёмам.
// На следующих шагах эпика демо-данные переедут на потоковый writer
// (prisma/seed/lib/writer.mjs), который не держит все строки в памяти сразу.
async function insertMany(model, rows) {
  for (let i = 0; i < rows.length; i += config.chunkSize) {
    await model.createMany({ data: rows.slice(i, i + config.chunkSize), skipDuplicates: true })
  }
  return rows.length
}

// Сброс 2FA на демо-аккаунтах. Привилегированным ролям 2FA обязательна (TwoFactorGuard),
// поэтому сид оставляет их с чистым состоянием: без включённой 2FA и без «висящего»
// pending-секрета от прошлой попытки настройки — иначе аутентификатор с прошлого QR
// продолжает показывать коды от секрета, которого на сервере уже нет. Сам форс отключается
// переменной TWO_FACTOR_ENFORCE=false в apps/api/.env (только для локальной разработки).
const TWO_FACTOR_RESET = {
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorBackupCodes: [],
}

// Медиа-пул из БД — для прогона только этапа вузов (SEED_ONLY=universities), когда шаг
// медиа не выполнялся. Без этого новые пользователи остались бы без аватаров, хотя
// объекты в MinIO уже лежат: пул целиком описан строками File с префиксом seed-media-.
async function loadMediaPool(prisma) {
  const files = await prisma.file.findMany({
    where: { id: { startsWith: 'seed-media-' } },
    select: { id: true, bucket: true, key: true, mime: true, size: true, posterKey: true },
    take: 5000,
  })
  if (files.length === 0) return null
  const storage = createStorage()
  const pool = { faces: [], photos: [], videos: [] }
  for (const file of files) {
    const entry = {
      fileId: file.id,
      bucket: file.bucket,
      key: file.key,
      url: storage.publicUrl(file.bucket, file.key),
      mime: file.mime,
      size: file.size,
    }
    // Портреты отличаются бакетом (avatars), а не полем: раскладку задаёт шаг медиа.
    if (file.mime.startsWith('video/')) pool.videos.push(entry)
    else if (file.bucket === storage.buckets.avatars) pool.faces.push(entry)
    else if (file.bucket === storage.buckets.profileMedia) pool.photos.push(entry)
  }
  return pool
}

// Компании платформы из БД — для прогона только этапа вузов (SEED_ONLY=universities).
async function loadCompanies(prisma) {
  const rows = await prisma.company.findMany({
    where: { id: { startsWith: 'seed-co-' } },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      members: { select: { userId: true }, take: 5 },
      vacancies: { where: { status: 'PUBLISHED' }, select: { id: true }, take: 20 },
    },
    take: 200,
  })
  return rows.map((c) => ({
    ...c,
    recruiterIds: c.members.map((m) => m.userId),
    vacancyIds: c.vacancies.map((v) => v.id),
  }))
}

async function main() {
  console.log(`Seed: профиль "${config.scale}" — ${config.scaleLabel}`)

  // Прогресс создаём в самом начале: он же измеряет длительность прогона.
  const progress = createProgress({ total: 1, label: 'Итого' })

  // ── Справочник КАТО (первым делом) ──────────────────────────────────────────
  // Не демо-данные: `University.city` хранит 9-значный код, и без справочника город
  // вуза не во что резолвить (селект «Город» пустой). Поэтому шаг обязателен и при
  // развёртывании; он идемпотентен (ON CONFLICT DO UPDATE).
  if (config.runs('kato')) {
    await seedKato(prisma)
  }

  // Один bcrypt-хэш на всех сид-пользователей. Это не оптимизация, а условие
  // выполнимости: 125 000 хэшей с cost=12 — это часы работы CPU.
  const passwordHash = await bcrypt.hash('Admin1234!', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@studenthub.app' },
    // Пароль/профиль при повторном запуске не трогаем, но 2FA сбрасываем: демо-аккаунт
    // должен пускать по одному паролю (см. TWO_FACTOR_RESET).
    update: TWO_FACTOR_RESET,
    create: {
      email: 'admin@studenthub.app',
      passwordHash,
      firstName: 'Платформенный',
      lastName: 'Администратор',
      role: 'PLATFORM_ADMIN',
      ...TWO_FACTOR_RESET,
    },
  })

  // Демо-структура (Фаза 5): вуз ACTIVE, факультет, группа, 3 аудитории.
  // `city` — код КАТО, а не название: 750000000 = г. Алматы (см. prisma/seed/steps/00-kato.mjs).
  // Поле есть и в update, чтобы прогон сида перевёл на код вузы, заведённые до справочника.
  const university = await prisma.university.upsert({
    where: { id: SEED_UNIVERSITY_ID },
    update: { name: 'Университет «Алатау»', shortName: 'АУ', city: ALMATY_KATO_CODE },
    create: {
      id: SEED_UNIVERSITY_ID,
      name: 'Университет «Алатау»',
      shortName: 'АУ',
      status: 'ACTIVE',
      country: 'Казахстан',
      city: ALMATY_KATO_CODE,
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
      // Синхронизируем имя на существующих dev-аккаунтах (иначе старые плейсхолдеры остаются)
      // и сбрасываем 2FA — иначе недонастроенный секрет переживает пересид.
      update: { firstName, lastName, ...TWO_FACTOR_RESET },
      create: { email, passwordHash, firstName, lastName, role, ...userScope, ...TWO_FACTOR_RESET },
    })
  }

  // ── Дисциплины (демо): семестр + справочная дисциплина + курс группы ──────────
  // Идемпотентно по фиксированным id. Позволяет проверить домен «Дисциплины» после миграции.
  const teacherUser = await prisma.user.findUnique({
    where: { email: 'teacher@studenthub.app' },
    select: { id: true },
  })
  const term = await prisma.term.upsert({
    where: { id: 'seed-term-001' },
    update: { name: 'Осень 2025', isActive: true },
    create: {
      id: 'seed-term-001',
      universityId: SEED_UNIVERSITY_ID,
      name: 'Осень 2025',
      number: 5,
      startsOn: new Date('2025-09-01'),
      endsOn: new Date('2025-12-31'),
      isActive: true,
    },
  })
  const subject = await prisma.subject.upsert({
    where: { id: 'seed-subject-001' },
    update: { name: 'Основы программирования', code: 'CS101' },
    create: {
      id: 'seed-subject-001',
      universityId: SEED_UNIVERSITY_ID,
      name: 'Основы программирования',
      code: 'CS101',
    },
  })
  await prisma.course.upsert({
    where: { id: 'seed-course-001' },
    update: { credits: 5, teacherId: teacherUser?.id ?? null, termId: term.id },
    create: {
      id: 'seed-course-001',
      subjectId: subject.id,
      groupId: 'seed-group-001',
      teacherId: teacherUser?.id ?? null,
      termId: term.id,
      credits: 5,
    },
  })

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

  // ═══════════════════════════════════════════════════════════════════════════
  //  БОЛЬШОЙ РЕАЛИСТИЧНЫЙ SEED: университет «Алатау» — 5 факультетов, 15 групп,
  //  студенты/старосты/преподаватели/деканы + расписание, оценки, посещаемость,
  //  экзамены, консультации, записи в деканат, портфолио, посты, события,
  //  материалы. Идемпотентно (фиксированные id + createMany skipDuplicates).
  // ═══════════════════════════════════════════════════════════════════════════
  const U = SEED_UNIVERSITY_ID
  const counts = {}
  const TEACHER_ID = teacherUser?.id ?? null

  const devIds = Object.fromEntries(
    (
      await prisma.user.findMany({
        where: {
          email: {
            in: [
              'dean@studenthub.app',
              'teacher@studenthub.app',
              'starosta@studenthub.app',
              'student@studenthub.app',
              'university-admin@studenthub.app',
              'university-moderator@studenthub.app',
            ],
          },
        },
        select: { id: true, email: true },
      })
    ).map((u) => [u.email, u.id]),
  )
  const adminId = devIds['university-admin@studenthub.app']

  const TIMES = [
    ['08:30', '10:00'],
    ['10:10', '11:40'],
    ['11:50', '13:20'],
    ['14:00', '15:30'],
    ['15:40', '17:10'],
  ]

  const FACS = [
    {
      id: 'seed-faculty-001',
      code: 'it',
      name: 'Факультет информационных технологий',
      prefix: 'ИТ',
      subjects: [
        ['Основы программирования', 'CS101'],
        ['Алгоритмы и структуры данных', 'CS201'],
        ['Базы данных', 'CS210'],
        ['Веб-разработка', 'CS230'],
        ['Операционные системы', 'CS240'],
        ['Машинное обучение', 'CS350'],
      ],
      specialties: ['Информационные системы', 'Программная инженерия', 'Вычислительная техника'],
    },
    {
      id: 'seed-fac-eco',
      code: 'eco',
      name: 'Экономический факультет',
      prefix: 'ЭК',
      subjects: [
        ['Микроэкономика', 'EC101'],
        ['Макроэкономика', 'EC102'],
        ['Бухгалтерский учёт', 'EC210'],
        ['Финансовый менеджмент', 'EC220'],
        ['Маркетинг', 'EC230'],
        ['Эконометрика', 'EC340'],
      ],
      specialties: ['Финансы', 'Учёт и аудит', 'Экономика предприятия'],
    },
    {
      id: 'seed-fac-law',
      code: 'law',
      name: 'Юридический факультет',
      prefix: 'Ю',
      subjects: [
        ['Теория государства и права', 'LW101'],
        ['Гражданское право', 'LW201'],
        ['Уголовное право', 'LW210'],
        ['Конституционное право', 'LW220'],
        ['Международное право', 'LW330'],
        ['Административное право', 'LW240'],
      ],
      specialties: ['Юриспруденция', 'Международное право'],
    },
    {
      id: 'seed-fac-eng',
      code: 'eng',
      name: 'Инженерный факультет',
      prefix: 'ИНЖ',
      subjects: [
        ['Высшая математика', 'EN101'],
        ['Физика', 'EN102'],
        ['Теоретическая механика', 'EN210'],
        ['Электротехника', 'EN220'],
        ['Материаловедение', 'EN230'],
        ['Сопротивление материалов', 'EN240'],
      ],
      specialties: ['Машиностроение', 'Электроэнергетика', 'Автоматизация'],
    },
    {
      id: 'seed-fac-sci',
      code: 'sci',
      name: 'Факультет естественных наук',
      prefix: 'ЕН',
      subjects: [
        ['Общая химия', 'SC101'],
        ['Молекулярная биология', 'SC201'],
        ['Органическая химия', 'SC210'],
        ['Генетика', 'SC220'],
        ['Экология', 'SC230'],
        ['Биохимия', 'SC340'],
      ],
      specialties: ['Химия', 'Биология', 'Экология'],
    },
  ]

  // Аудитории (18 новых + 3 демо).
  const roomIds = ['seed-room-101', 'seed-room-102', 'seed-room-103']
  const roomRows = []
  for (let r = 0; r < 18; r += 1) {
    const id = `seed-room-${200 + r}`
    roomIds.push(id)
    roomRows.push({ id, name: `${200 + r}`, capacity: pick([24, 30, 40, 50, 60]), universityId: U })
  }
  await insertMany(prisma.room, roomRows)

  // ── Факультеты / специальности / предметы / деканы / преподаватели / группы ──
  const allUsers = []
  const facTeachers = {}
  const groupList = []
  let uc = 0

  for (const fac of FACS) {
    await prisma.faculty.upsert({
      where: { id: fac.id },
      update: { name: fac.name },
      create: { id: fac.id, name: fac.name, universityId: U },
    })
    for (const [si, sp] of fac.specialties.entries()) {
      const id = `seed-spec-${fac.code}-${si}`
      await prisma.specialty.upsert({
        where: { id },
        update: { name: sp },
        create: { id, name: sp, universityId: U },
      })
    }

    // Декан (IT — существующий dean@, остальные — новые).
    let deanId = devIds['dean@studenthub.app']
    if (fac.code !== 'it') {
      deanId = `seed-dean-${fac.code}`
      allUsers.push({
        id: deanId,
        email: `dean.${fac.code}@alatau.edu.kz`,
        passwordHash,
        ...person(uc++),
        role: 'DEAN',
        universityId: U,
        facultyId: fac.id,
        position: 'Декан факультета',
        academicDegree: 'Доктор наук',
        academicTitle: 'Профессор',
      })
    }
    fac.deanId = deanId

    // Преподаватели (IT включает teacher@).
    const tids = fac.code === 'it' && TEACHER_ID ? [TEACHER_ID] : []
    for (let k = 0; k < (fac.code === 'it' ? 4 : 5); k += 1) {
      const id = `seed-t-${fac.code}-${k}`
      tids.push(id)
      allUsers.push({
        id,
        email: `t.${fac.code}.${k}@alatau.edu.kz`,
        passwordHash,
        ...person(uc++),
        role: 'TEACHER',
        universityId: U,
        facultyId: fac.id,
        position: 'Преподаватель',
        academicDegree: pick(['Кандидат наук', 'PhD', 'Магистр']),
        department: fac.name,
      })
    }
    facTeachers[fac.code] = tids

    // Предметы вуза (IT/CS101 переиспользует демо-предмет seed-subject-001).
    fac.subjectList = []
    for (const [name, code] of fac.subjects) {
      const id = code === 'CS101' ? 'seed-subject-001' : `seed-subj-${code}`
      await prisma.subject.upsert({
        where: { id },
        update: { name, code },
        create: { id, universityId: U, name, code },
      })
      fac.subjectList.push({ id, name, code })
    }

    // Группы (3 набора: 2022/2023/2024). IT/2023 — существующая seed-group-001 (ИТ-23-1).
    const years = [2022, 2023, 2024]
    for (let g = 0; g < 3; g += 1) {
      const year = years[g]
      const isDemoGroup = fac.code === 'it' && g === 1
      const gid = isDemoGroup ? 'seed-group-001' : `seed-g-${fac.code}-${g}`
      const gname = isDemoGroup ? 'ИТ-23-1' : `${fac.prefix}-${String(year).slice(2)}-1`
      await prisma.group.upsert({
        where: { id: gid },
        update: { name: gname, year },
        create: { id: gid, name: gname, year, facultyId: fac.id },
      })

      const studentIds = []
      for (let s = 0; s < 24; s += 1) {
        const gi = uc++
        const sid = `seed-st-${gid}-${s}`
        const isStarosta = s === 0 && !isDemoGroup
        studentIds.push(sid)
        allUsers.push({
          id: sid,
          email: `st.${fac.code}.${g}.${s}@alatau.edu.kz`,
          passwordHash,
          ...person(gi),
          role: isStarosta ? 'STAROSTA' : 'STUDENT',
          universityId: U,
          facultyId: fac.id,
          groupId: gid,
          course: 2025 - year,
          enrollmentYear: year,
          educationLevel: 'BACHELOR',
          studyForm: pick(['FULL_TIME', 'FULL_TIME', 'PART_TIME']),
          academicStatus: 'ACTIVE',
          studentCardNumber: `${year}${String(gi).padStart(5, '0')}`,
          gpa: Number((2.5 + rng() * 1.5).toFixed(2)),
          ...(isStarosta
            ? { starostaSince: new Date(`${year}-09-01`), duties: 'Староста группы' }
            : {}),
        })
      }
      // Демо-группа: вплетаем именованные dev-аккаунты (студент + староста) как реальных
      // членов группы, чтобы у них были оценки/посещаемость/экзамены — иначе студенческие
      // вкладки старосты (starosta@studenthub.app) выглядели бы пустыми. Добавляем в конец,
      // чтобы не смещать PRNG-последовательность существующих строк (id детерминированы по sid).
      if (isDemoGroup) {
        for (const email of ['student@studenthub.app', 'starosta@studenthub.app']) {
          if (devIds[email]) studentIds.push(devIds[email])
        }
      }
      const starostaId = isDemoGroup ? devIds['starosta@studenthub.app'] : studentIds[0]
      groupList.push({
        id: gid,
        facCode: fac.code,
        facId: fac.id,
        name: gname,
        year,
        studentIds,
        starostaId,
        teacherIds: tids,
        courses: [],
        pairs: [],
      })
    }
  }

  counts.users = await insertMany(prisma.user, allUsers)
  for (const g of groupList) {
    if (g.starostaId)
      await prisma.group
        .update({ where: { id: g.id }, data: { starostaId: g.starostaId } })
        .catch(() => {})
  }
  const allStudentIds = groupList.flatMap((g) => g.studentIds)
  const allTeacherIds = [...new Set(Object.values(facTeachers).flat())]

  // ── Курсы (дисциплина группы в семестре) ────────────────────────────────────
  const courseRows = []
  for (const g of groupList) {
    const fac = FACS.find((f) => f.code === g.facCode)
    for (const subj of fac.subjectList) {
      const isDemo = subj.id === 'seed-subject-001' && g.id === 'seed-group-001'
      const cid = isDemo ? 'seed-course-001' : `seed-c-${g.id}-${subj.code}`
      const teacherId = isDemo ? TEACHER_ID : pick(g.teacherIds)
      if (!isDemo)
        courseRows.push({
          id: cid,
          subjectId: subj.id,
          groupId: g.id,
          teacherId,
          termId: 'seed-term-001',
          credits: pick([3, 4, 5, 6]),
        })
      g.courses.push({ cid, subj, teacherId })
    }
  }
  counts.courses = (await insertMany(prisma.course, courseRows)) + 1

  // ── Расписание + пары ───────────────────────────────────────────────────────
  const scheduleRows = []
  const pairRows = []
  for (const g of groupList) {
    const schId = `seed-sch-${g.id}`
    scheduleRows.push({ id: schId, groupId: g.id, name: 'Осенний семестр 2025/26', isActive: true })
    g.courses.forEach((c, idx) => {
      const day = (idx % 5) + 1
      const slot = TIMES[idx % TIMES.length]
      const pid = `seed-p-${g.id}-${idx}`
      pairRows.push({
        id: pid,
        scheduleId: schId,
        groupId: g.id,
        subject: c.subj.name,
        teacherId: c.teacherId,
        roomId: pick(roomIds),
        dayOfWeek: day,
        startTime: slot[0],
        endTime: slot[1],
        weekType: 'BOTH',
      })
      g.pairs.push({ pid, day, teacherId: c.teacherId })
    })
  }
  await insertMany(prisma.schedule, scheduleRows)
  counts.pairs = await insertMany(prisma.pair, pairRows)

  // ── Журнал оценок ───────────────────────────────────────────────────────────
  const colRows = []
  const gradeRows = []
  const COLS = [
    ['LAB', 'Лабораторные', 30],
    ['CONTROL', 'Контрольная', 30],
    ['EXAM', 'Итоговый', 40],
  ]
  for (const g of groupList) {
    for (const c of g.courses) {
      COLS.forEach((k, ki) => {
        const colId = `seed-gc-${c.cid}-${ki}`
        colRows.push({
          id: colId,
          courseId: c.cid,
          createdById: c.teacherId,
          title: k[1],
          kind: k[0],
          maxScore: k[2],
          position: ki,
          published: true,
        })
        for (const sid of g.studentIds) {
          gradeRows.push({
            id: `seed-gr-${colId}-${sid}`,
            columnId: colId,
            studentId: sid,
            score: chance(0.9) ? Number((k[2] * (0.5 + rng() * 0.5)).toFixed(1)) : null,
          })
        }
      })
    }
  }
  await insertMany(prisma.gradeColumn, colRows)
  counts.grades = await insertMany(prisma.grade, gradeRows)

  // ── Задания + сдачи ─────────────────────────────────────────────────────────
  const asgRows = []
  const subRows = []
  for (const g of groupList) {
    for (const c of g.courses) {
      for (let a = 0; a < 2; a += 1) {
        const aid = `seed-as-${c.cid}-${a}`
        asgRows.push({
          id: aid,
          courseId: c.cid,
          createdById: c.teacherId,
          title: `${c.subj.name}: задание ${a + 1}`,
          description: 'Выполните задание и приложите решение.',
          type: pick(['HOMEWORK', 'LAB', 'PROJECT']),
          submissionType: 'TEXT',
          status: 'PUBLISHED',
          maxScore: 100,
          allowLate: chance(0.5),
          publishAt: daysFromNow(-20 + a * 7),
          dueAt: daysFromNow(-5 + a * 10),
        })
        for (const sid of g.studentIds) {
          if (!chance(0.8)) continue
          const graded = chance(0.7)
          subRows.push({
            id: `seed-sub-${aid}-${sid}`,
            assignmentId: aid,
            studentId: sid,
            status: graded ? 'GRADED' : 'SUBMITTED',
            text: 'Решение прикреплено.',
            attemptNumber: 1,
            score: graded ? randInt(50, 100) : null,
            gradedById: graded ? c.teacherId : null,
            submittedAt: daysFromNow(-3),
            gradedAt: graded ? daysFromNow(-1) : null,
          })
        }
      }
    }
  }
  counts.assignments = await insertMany(prisma.assignment, asgRows)
  counts.submissions = await insertMany(prisma.submission, subRows)

  // ── Посещаемость (первые 3 пары каждой группы × ATT_WEEKS недель) ────────────
  // Даты — относительно сегодняшнего дня, как и всё остальное в сидере. Раньше здесь
  // стоял жёсткий ноябрь 2025: данные уезжали в прошлое вместе с календарём, и любое
  // окно «за последние N недель» на дашборде оказывалось пустым.
  //
  // Опорная точка — понедельник текущей недели, недели отсчитываем назад.
  const attMonday = (() => {
    const d = daysFromNow(0)
    const iso = (d.getUTCDay() + 6) % 7
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - iso))
  })()
  const attRows = []
  for (const g of groupList) {
    for (const p of g.pairs.slice(0, 3)) {
      for (let w = 0; w < ATT_WEEKS; w += 1) {
        const d = new Date(attMonday)
        d.setUTCDate(d.getUTCDate() + (p.day - 1) - 7 * (ATT_WEEKS - 1 - w))
        for (const sid of g.studentIds) {
          const roll = rng()
          const status =
            roll < 0.8 ? 'PRESENT' : roll < 0.9 ? 'LATE' : roll < 0.97 ? 'ABSENT' : 'EXCUSED'
          attRows.push({
            // Идентификатор по дате, а не по номеру недели: номер «плывёт» вместе с
            // окном, и повторный прогон подсунул бы старой строке новую дату.
            id: `seed-att-${p.pid}-${d.toISOString().slice(0, 10)}-${sid}`,
            pairId: p.pid,
            studentId: sid,
            date: d,
            status,
            markedById: p.teacherId,
          })
        }
      }
    }
  }
  // Чистим ТОЛЬКО строки, созданные этим же сидером (префикс seed-att-): без этого
  // прогоны разных дат накапливались бы слоями и завышали статистику.
  await prisma.attendance.deleteMany({ where: { id: { startsWith: 'seed-att-' } } })
  counts.attendance = await insertMany(prisma.attendance, attRows)

  // ── Экзамены + результаты ───────────────────────────────────────────────────
  const examRows = []
  const examResRows = []
  for (const g of groupList) {
    for (const c of g.courses) {
      const eid = `seed-ex-${c.cid}`
      examRows.push({
        id: eid,
        courseId: c.cid,
        groupId: g.id,
        createdById: c.teacherId,
        examinerId: c.teacherId,
        roomId: pick(roomIds),
        date: daysFromNow(randInt(10, 40)),
        format: pick(['WRITTEN', 'ORAL', 'TEST']),
        maxScore: 100,
      })
      for (const sid of g.studentIds) {
        const st = pick(['SCHEDULED', 'SCHEDULED', 'PASSED', 'PASSED', 'FAILED', 'RETAKE'])
        examResRows.push({
          id: `seed-exr-${eid}-${sid}`,
          examId: eid,
          studentId: sid,
          admitted: chance(0.95),
          status: st,
          score: st === 'PASSED' ? randInt(60, 100) : st === 'FAILED' ? randInt(20, 49) : null,
          attempt: 1,
        })
      }
    }
  }
  counts.exams = await insertMany(prisma.exam, examRows)
  counts.examResults = await insertMany(prisma.examResult, examResRows)

  // ── Консультации (слоты преподавателей, часть забронирована) ─────────────────
  const consRows = []
  for (const tid of allTeacherIds) {
    for (let s = 0; s < 3; s += 1) {
      const start = daysFromNow(randInt(1, 14))
      start.setHours(10 + s, 0, 0, 0)
      const end = new Date(start.getTime() + 45 * 60000)
      const booked = s === 0 && chance(0.6)
      consRows.push({
        id: `seed-cons-${tid}-${s}`,
        teacherId: tid,
        startsAt: start,
        endsAt: end,
        location: `каб. ${randInt(100, 300)}`,
        isOnline: chance(0.3),
        status: booked ? 'BOOKED' : 'OPEN',
        studentId: booked ? pick(allStudentIds) : null,
        topic: booked ? 'Вопрос по курсовой работе' : null,
      })
    }
  }
  counts.consultations = await insertMany(prisma.consultationSlot, consRows)

  // ── Записи в деканат ────────────────────────────────────────────────────────
  const apptRows = []
  for (let a = 0; a < 30; a += 1) {
    const g = pick(groupList)
    const st = pick(['REQUESTED', 'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'])
    const scheduled = st === 'CONFIRMED' || st === 'COMPLETED' ? daysFromNow(randInt(1, 7)) : null
    apptRows.push({
      id: `seed-appt-${a}`,
      studentId: pick(g.studentIds),
      facultyId: g.facId,
      assignedToId: FACS.find((f) => f.code === g.facCode).deanId,
      type: pick(['CONSULTATION', 'DOCUMENT', 'ACADEMIC', 'OTHER']),
      status: st,
      topic: pick([
        'Вопрос по стипендии',
        'Академический отпуск',
        'Пересдача экзамена',
        'Справка об обучении',
      ]),
      requestedAt: daysFromNow(randInt(-10, -1)),
      scheduledAt: scheduled,
      staffNote: scheduled ? 'Ожидаем вас в деканате' : null,
    })
  }
  counts.appointments = await insertMany(prisma.deaneryAppointment, apptRows)

  // ── Портфолио (первые 3 студента каждой группы) ─────────────────────────────
  const pfRows = []
  for (const g of groupList) {
    for (const sid of g.studentIds.slice(0, 3)) {
      pfRows.push({
        id: `seed-pf-${sid}-0`,
        userId: sid,
        kind: 'EDUCATION',
        title: `Бакалавриат, ${g.name}`,
        organization: 'Университет «Алатау»',
        description: 'Обучение по программе бакалавриата.',
        startDate: new Date(`${g.year}-09-01`),
        visibility: 'UNIVERSITY',
        order: 0,
      })
      pfRows.push({
        id: `seed-pf-${sid}-1`,
        userId: sid,
        kind: pick(['PROJECT', 'CERTIFICATE', 'ACHIEVEMENT']),
        title: pick(['Хакатон AlmaHack', 'Сертификат Python (Coursera)', 'Победитель олимпиады']),
        organization: pick(['Alatau IT Hub', 'Coursera', 'МОН РК']),
        description: 'Достижение студента.',
        startDate: daysFromNow(-200),
        visibility: pick(['PUBLIC', 'UNIVERSITY', 'PRIVATE']),
        order: 1,
      })
    }
  }
  counts.portfolio = await insertMany(prisma.portfolioItem, pfRows)

  // ── Посты (вуз/факультет/группа) + события + материалы ──────────────────────
  const postRows = []
  let po = 0
  for (const txt of [
    'Добро пожаловать на портал университета «Алатау»!',
    'Расписание зимней сессии опубликовано',
    'Стипендиальная комиссия начинает работу',
    'Открыта новая IT-лаборатория',
    'График работы деканатов на праздники',
  ]) {
    postRows.push({
      id: `seed-post-${po++}`,
      authorId: adminId,
      audience: 'UNIVERSITY',
      content: txt,
      universityId: U,
      status: 'PUBLISHED',
      publishedAt: daysFromNow(-randInt(1, 20)),
    })
  }
  for (const fac of FACS) {
    for (let k = 0; k < 2; k += 1) {
      postRows.push({
        id: `seed-post-${po++}`,
        authorId: fac.deanId,
        audience: 'FACULTY',
        content: pick([
          'Собрание факультета в пятницу в 15:00',
          'Открыта запись на пересдачи',
          'Конференция молодых учёных',
          'Изменения в расписании со следующей недели',
        ]),
        universityId: U,
        facultyId: fac.id,
        status: 'PUBLISHED',
        publishedAt: daysFromNow(-randInt(1, 15)),
      })
    }
  }
  for (const g of groupList.slice(0, 8)) {
    postRows.push({
      id: `seed-post-${po++}`,
      authorId: g.starostaId,
      audience: 'GROUP',
      content: pick([
        'Сдаём лабораторные до пятницы',
        'Собираем на подарок преподавателю',
        'Кто идёт на субботник в субботу?',
      ]),
      universityId: U,
      facultyId: g.facId,
      groupId: g.id,
      status: 'PUBLISHED',
      publishedAt: daysFromNow(-randInt(1, 10)),
    })
  }
  counts.posts = await insertMany(prisma.post, postRows)

  const eventRows = []
  for (let e = 0; e < 12; e += 1) {
    const fac = pick(FACS)
    const uni = chance(0.4)
    eventRows.push({
      id: `seed-ev-${e}`,
      organizerId: uni ? adminId : fac.deanId,
      audience: uni ? 'UNIVERSITY' : 'FACULTY',
      title: pick([
        'День открытых дверей',
        'Научная конференция',
        'Спортивный турнир',
        'Ярмарка вакансий',
        'Мастер-класс по карьере',
      ]),
      description: 'Приглашаем всех желающих принять участие.',
      universityId: U,
      facultyId: uni ? null : fac.id,
      location: pick(['Актовый зал', 'Спортзал', 'Аудитория 200', null]),
      isOnline: chance(0.25),
      startsAt: daysFromNow(randInt(2, 30)),
    })
  }
  counts.events = await insertMany(prisma.event, eventRows)

  const matRows = []
  for (const g of groupList) {
    for (const c of g.courses) {
      matRows.push({
        id: `seed-mat-${c.cid}`,
        teacherId: c.teacherId,
        groupId: g.id,
        subject: c.subj.name,
        title: `Лекции: ${c.subj.name}`,
        description: 'Конспекты и слайды по курсу.',
        url: 'https://example.edu/materials',
      })
    }
  }
  counts.materials = await insertMany(prisma.material, matRows)

  // ── Документы (Ф15): личные и выданные вузом, доступы, журнал, запрос вуза ───
  // Файлы намеренно не создаём: объектов в MinIO нет, и «Открыть/Скачать» вело бы
  // в ошибку хранилища. Документы живут метаданными — этого хватает всем экранам
  // раздела, кроме просмотра содержимого.
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
    ISSUED_BY_UNIVERSITY: 'Университет «Алатау»',
  }

  const docRows = []
  const docAccessRows = []
  const docEventRows = []
  // Документы есть у первых четырёх студентов каждой группы — этого хватает для
  // списков, обзора и запросов вуза, но seed не раздувается на все 348 человек.
  const docOwners = []
  for (const g of groupList) {
    for (const sid of g.studentIds.slice(0, 4)) docOwners.push({ sid, g })
  }

  for (const [oi, { sid, g }] of docOwners.entries()) {
    // Набор личных документов: у каждого свои 4–6 позиций из шаблонов.
    const take = randInt(4, DOC_TEMPLATES.length)
    for (let i = 0; i < take; i += 1) {
      const [type, category, status, expiresIn] = DOC_TEMPLATES[i]
      const id = `seed-doc-${sid}-${type}`
      const archived = status === 'ACCEPTED' && chance(0.12)
      const last4 = String(1000 + randInt(0, 8999))
      docRows.push({
        id,
        ownerId: sid,
        universityId: U,
        category,
        type,
        title: DOC_TITLES[type] ?? type,
        number: `AA${randInt(100000, 999999)}${last4}`,
        numberLast4: last4,
        issuedBy: ISSUERS[category],
        issuedAt: daysFromNow(-randInt(200, 2000)),
        expiresAt: expiresIn === null ? null : daysFromNow(expiresIn),
        status: archived ? 'ARCHIVED' : status,
        rejectionReason: status === 'REJECTED' ? 'Скан нечитаемый — переснимите документ' : null,
        archivedAt: archived ? daysFromNow(-randInt(10, 120)) : null,
        createdAt: daysFromNow(-randInt(5, 400)),
      })
      docEventRows.push({
        id: `seed-docev-${id}-up`,
        documentId: id,
        actorId: sid,
        action: 'UPLOAD',
        createdAt: daysFromNow(-randInt(5, 400)),
      })
      // Часть документов открыта вузу или факультету: активные гранты, отозванные
      // и просроченные — раздел «Управление доступом» должен показывать все три.
      if (i < 2 && chance(0.6)) {
        const expired = chance(0.35)
        const revoked = !expired && chance(0.25)
        docAccessRows.push({
          id: `seed-docacc-${id}`,
          documentId: id,
          granteeType: chance(0.6) ? 'UNIVERSITY' : 'DEPARTMENT',
          granteeId: chance(0.6) ? null : g.facId,
          reason: pick([
            'оформление личного дела',
            'проверка данных при заселении',
            'подготовка приказа о зачислении',
          ]),
          grantedById: sid,
          grantedAt: daysFromNow(-randInt(30, 300)),
          expiresAt: expired ? daysFromNow(-randInt(1, 40)) : chance(0.5) ? daysFromNow(180) : null,
          revokedAt: revoked ? daysFromNow(-randInt(1, 20)) : null,
        })
        docEventRows.push({
          id: `seed-docev-${id}-grant`,
          documentId: id,
          actorId: sid,
          action: 'GRANT',
          createdAt: daysFromNow(-randInt(30, 300)),
        })
      }
    }

    // Выданные вузом (раздел «Документы от университета»).
    for (const type of ['STUDENT_ID', 'ENROLLMENT_ORDER', 'CAMPUS_PASS']) {
      if (type === 'CAMPUS_PASS' && oi % 3 !== 0) continue
      const id = `seed-doc-${sid}-${type}`
      const last4 = String(1000 + randInt(0, 8999))
      docRows.push({
        id,
        ownerId: sid,
        universityId: U,
        category: 'ISSUED_BY_UNIVERSITY',
        type,
        title: DOC_TITLES[type],
        number: `${g.year}-${last4}`,
        numberLast4: last4,
        issuedBy: ISSUERS.ISSUED_BY_UNIVERSITY,
        issuedAt: new Date(`${g.year}-09-01`),
        expiresAt: type === 'CAMPUS_PASS' ? daysFromNow(randInt(-10, 25)) : null,
        status: 'ACCEPTED',
        issuedByUniversity: true,
        createdAt: new Date(`${g.year}-09-01`),
      })
    }
  }
  counts.documents = await insertMany(prisma.document, docRows)
  counts.documentAccess = await insertMany(prisma.documentAccess, docAccessRows)
  counts.documentEvents = await insertMany(prisma.documentEvent, docEventRows)

  // Запрос вуза на комплект документов + ответы студентов (Ф15C/D).
  const reqId = 'seed-docreq-001'
  await prisma.documentRequest.upsert({
    where: { id: reqId },
    update: {},
    create: {
      id: reqId,
      universityId: U,
      createdById: FACS[0].deanId,
      title: 'Комплект документов на новый учебный год',
      description: 'Загрузите действующие документы до начала сессии.',
      dueAt: daysFromNow(21),
      status: 'OPEN',
    },
  })
  const reqItems = [
    ['ID_CARD', 'Удостоверение личности', true],
    ['MEDICAL', 'Медицинская справка 086-У', true],
    ['SOCIAL_REFERENCE', 'Справка о составе семьи', false],
  ]
  await insertMany(
    prisma.documentRequestItem,
    reqItems.map(([type, title, required], i) => ({
      id: `seed-docreq-item-${i}`,
      requestId: reqId,
      documentType: type,
      title,
      required,
      order: i,
    })),
  )
  await insertMany(prisma.documentRequestTarget, [
    { id: 'seed-docreq-target-0', requestId: reqId, targetType: 'UNIVERSITY', targetId: null },
  ])

  const subRowsDoc = []
  const subItemRowsDoc = []
  // Комплекты собирают первые 12 владельцев документов: часть отправлена и проверена,
  // часть осталась черновиком — на экране сотрудника видно все стадии.
  for (const [i, { sid }] of docOwners.slice(0, 12).entries()) {
    const sent = i % 3 !== 2
    const subId = `seed-docsub-${sid}`
    subRowsDoc.push({
      id: subId,
      requestId: reqId,
      studentId: sid,
      status: sent ? (i % 4 === 0 ? 'ACCEPTED' : 'SUBMITTED') : 'DRAFT',
      submittedAt: sent ? daysFromNow(-randInt(1, 10)) : null,
      reviewedById: i % 4 === 0 ? FACS[0].deanId : null,
      reviewedAt: i % 4 === 0 ? daysFromNow(-randInt(0, 5)) : null,
    })
    for (const [j, [type]] of reqItems.entries()) {
      const docId = `seed-doc-${sid}-${type}`
      if (!docRows.some((d) => d.id === docId)) continue
      subItemRowsDoc.push({
        id: `seed-docsubit-${sid}-${j}`,
        submissionId: subId,
        requestItemId: `seed-docreq-item-${j}`,
        documentId: docId,
        status: i % 4 === 0 ? 'ACCEPTED' : 'PENDING',
        reviewedById: i % 4 === 0 ? FACS[0].deanId : null,
        reviewedAt: i % 4 === 0 ? daysFromNow(-randInt(0, 5)) : null,
      })
    }
  }
  counts.documentSubmissions = await insertMany(prisma.documentSubmission, subRowsDoc)
  await insertMany(prisma.documentSubmissionItem, subItemRowsDoc)

  // Журнал спец-доступа платформенного админа (экран «Доступ к документам»):
  // записи аудита с причиной — ровно то, что пишет documents.service в этом режиме.
  const paReasons = [
    'проверка жалобы №12',
    'обращение в поддержку: не открывается диплом',
    'сверка данных по запросу деканата',
    'расследование дубликата удостоверения',
  ]
  const auditRows = []
  for (const [i, doc] of docRows.slice(0, 8).entries()) {
    const reason = paReasons[i % paReasons.length]
    auditRows.push({
      id: `seed-audit-pa-view-${i}`,
      userId: admin.id,
      action: 'DOCUMENT_PLATFORM_VIEW',
      entity: 'Document',
      entityId: doc.id,
      createdAt: daysFromNow(-i - 1),
    })
    if (i % 2 === 0) {
      auditRows.push({
        id: `seed-audit-pa-file-${i}`,
        userId: admin.id,
        action: 'DOCUMENT_PLATFORM_DOWNLOAD',
        entity: 'Document',
        entityId: doc.id,
        metadata: { fileId: `seed-file-${i}`, reason },
        createdAt: daysFromNow(-i - 1),
      })
    }
  }
  counts.platformDocAudit = await insertMany(prisma.auditLog, auditRows)

  progress.addRows(Object.values(counts).reduce((a, b) => a + b, 0))

  console.log('Seed готов:')
  console.log('  PLATFORM_ADMIN: admin@studenthub.app / Admin1234!  (сменить сразу)')
  console.log('  Именованные роли (пароль у всех Admin1234!):')
  for (const [role, email] of devUsers) {
    console.log(`    ${role}: ${email}`)
  }
  console.log('  2FA у всех сброшена. Чтобы форс не требовал настройки на привилегированных')
  console.log('  ролях, локально: TWO_FACTOR_ENFORCE=false в apps/api/.env')
  console.log('  Университет «Алатау» (ACTIVE): 5 факультетов, 15 групп.')
  progress.report(counts)

  // ── Медиа: общий пул фото и видео в MinIO ───────────────────────────────────
  // До генератора вузов: аватары и обложки раздаются всем пользователям, включая
  // демо-вуз. Пул нужен и следующим шагам эпика (вложения постов, чатов, альбомы).
  let mediaPool = null
  if (config.media && config.runs('media')) {
    mediaPool = await seedMedia(prisma, config)
  }

  // ── Работодатели (общие для всех вузов) ─────────────────────────────────────
  // До вузов: доступы к вузу и решения по вакансиям создаёт уже шаг карьеры внутри
  // вуза, и компании к тому моменту должны существовать.
  let companies = null
  if (config.universities > 0 && config.runs('companies')) {
    const companyWriter = createWriter(prisma, { chunkSize: config.chunkSize })
    companies = await seedCompanies(prisma, companyWriter, { passwordHash })
  }

  // ── Генератор вузов (SEED_SCALE=small|full) ─────────────────────────────────
  // Демо-вуз выше остаётся как есть; генератор создаёт свои вузы u001…uN рядом.
  if (config.universities > 0 && config.runs('universities')) {
    // Без этапа companies (SEED_ONLY=universities) карьерные компании берём из БД:
    // они общие для платформы и обычно уже залиты предыдущим прогоном.
    const linkedCompanies = companies ?? (await loadCompanies(prisma))
    await seedUniversities(prisma, {
      config,
      passwordHash,
      pool: mediaPool ?? (config.media ? await loadMediaPool(prisma) : null),
      companies: linkedCompanies,
    })
  }
  // ── Демо-дополнения ─────────────────────────────────────────────────────────
  // Друзья dev-аккаунтов, очередь заявок демо-вуза, жалобы, воронка инвайтов и
  // история для дашборда платформы (даты регистрации, журнал аудита).
  if (config.runs('demo')) {
    const demoWriter = createWriter(prisma, { chunkSize: config.chunkSize })
    await seedDemoExtras(prisma, demoWriter, { random: makeRandom(20260902) })
    await demoWriter.flush()
  }

  console.log(`  dev-инвайт UNIVERSITY_ADMIN: /register?token=${DEV_INVITE_TOKEN}`)
}

main()
  .catch((error) => {
    console.error('Seed упал:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
