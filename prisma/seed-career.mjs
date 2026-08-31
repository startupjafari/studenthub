// Демо-данные карьерного модуля (Фаза 18) — объёмные, чтобы проверялись пагинация,
// фильтры, воронка, мультивузовость и очереди модерации.
//
// Зачем сид вообще: пройти цепочку руками — это регистрация, письмо, подтверждение,
// заявка в вуз, одобрение, публикация вакансии, ещё одно одобрение. Для проверки экранов
// это десятки минут; сид ставит систему в состояние «всё уже случилось», причём в разных
// состояниях сразу.
//
// Идемпотентен: все записи с фиксированными id (`seed-career-…`), перед вставкой они
// удаляются. Ничего, кроме своих данных, сид не трогает.
//
// Запуск: pnpm db:seed:career   (перед ним нужен pnpm db:seed)
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Детерминированный PRNG (mulberry32) — как в основном сиде: данные воспроизводимы
// между прогонами, диффы читаемы.
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = makeRng(20260830)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const pickMany = (arr, n) => {
  const copy = [...arr]
  const out = []
  for (let i = 0; i < n && copy.length > 0; i++)
    out.push(...copy.splice(Math.floor(rng() * copy.length), 1))
  return out
}
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))
const chance = (p) => rng() < p
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000)

const PASSWORD = 'Admin1234!'
const PREFIX = 'seed-career-'
const UNI2_ID = 'seed-university-002'

// ── Справочники ──────────────────────────────────────────────────────────────

const COMPANIES = [
  [
    'Алатау Софт',
    'alatau-soft',
    'Продуктовая команда из Алматы: внутренние сервисы для банков и логистики.',
  ],
  [
    'Kaspi Lab',
    'kaspi-lab',
    'Финтех-лаборатория. Мобильные и веб-продукты для миллионов пользователей.',
  ],
  [
    'Digital Nomads KZ',
    'digital-nomads-kz',
    'Аутсорс-разработка для клиентов из Европы и Ближнего Востока.',
  ],
  [
    'Tumar Analytics',
    'tumar-analytics',
    'Данные и аналитика: витрины, дашборды, ML-модели для ритейла.',
  ],
  ['Steppe Robotics', 'steppe-robotics', 'Промышленная автоматизация и компьютерное зрение.'],
  ['Astana Cloud', 'astana-cloud', 'Облачная инфраструктура и DevOps-практики для госсектора.'],
  ['Baiterek Media', 'baiterek-media', 'Медиахолдинг: редакция, продакшн, digital-реклама.'],
  ['QazTech Solutions', 'qaztech-solutions', 'Системная интеграция и корпоративные порталы.'],
  ['Aiyl Logistics', 'aiyl-logistics', 'Логистический оператор: склады, маршрутизация, трекинг.'],
  ['Zhibek Retail', 'zhibek-retail', 'Розничная сеть: ИТ-департамент, касса и мерч-системы.'],
  ['Nomad Games', 'nomad-games', 'Инди-студия мобильных игр. Unity, аналитика, live-ops.'],
  [
    'Altyn Bank Digital',
    'altyn-bank-digital',
    'Цифровой банк: мобильное приложение и открытые API.',
  ],
  ['EduTech Qazaq', 'edutech-qazaq', 'Образовательная платформа для школ и колледжей.'],
  ['Turan Consulting', 'turan-consulting', 'Управленческий консалтинг и аудит процессов.'],
  ['Silk Road Ventures', 'silk-road-ventures', 'Венчурный фонд и акселератор ранних стадий.'],
]

const CITIES = ['750000000', '710000000', '350000000', '550000000', '450000000']

const ROLES = [
  [
    'Стажёр-разработчик (Frontend)',
    ['React', 'TypeScript', 'HTML', 'CSS', 'Git'],
    'INTERNSHIP',
    'NO_EXPERIENCE',
  ],
  [
    'Стажёр-разработчик (Backend)',
    ['Node.js', 'PostgreSQL', 'Git', 'REST API'],
    'INTERNSHIP',
    'NO_EXPERIENCE',
  ],
  ['Junior Frontend-разработчик', ['React', 'TypeScript', 'Next.js', 'CSS'], 'FULL_TIME', 'JUNIOR'],
  [
    'Junior Backend-разработчик',
    ['Node.js', 'PostgreSQL', 'Docker', 'TypeScript'],
    'FULL_TIME',
    'JUNIOR',
  ],
  ['Мобильный разработчик (Flutter)', ['Flutter', 'Dart', 'Git'], 'FULL_TIME', 'JUNIOR'],
  ['Аналитик данных', ['SQL', 'Python', 'Excel', 'Power BI'], 'FULL_TIME', 'INTERN'],
  ['Стажёр-аналитик', ['SQL', 'Excel', 'Python'], 'INTERNSHIP', 'NO_EXPERIENCE'],
  ['QA-инженер', ['Тестирование', 'SQL', 'Git'], 'FULL_TIME', 'JUNIOR'],
  ['Стажёр QA', ['Тестирование', 'Git'], 'INTERNSHIP', 'NO_EXPERIENCE'],
  ['DevOps-инженер', ['Docker', 'Kubernetes', 'Linux', 'CI/CD'], 'FULL_TIME', 'MIDDLE'],
  ['UI/UX дизайнер', ['Figma', 'Прототипирование', 'UX-исследования'], 'PART_TIME', 'JUNIOR'],
  [
    'Продуктовый менеджер',
    ['Аналитика', 'Коммуникация', 'Управление проектами'],
    'FULL_TIME',
    'MIDDLE',
  ],
  ['Контент-маркетолог', ['Копирайтинг', 'SMM', 'Аналитика'], 'PART_TIME', 'JUNIOR'],
  ['Технический писатель', ['Копирайтинг', 'Git', 'Markdown'], 'CONTRACT', 'JUNIOR'],
  ['Стажёр в отдел логистики', ['Excel', 'Аналитика'], 'INTERNSHIP', 'NO_EXPERIENCE'],
  ['Специалист поддержки', ['Коммуникация', 'SQL'], 'PART_TIME', 'NO_EXPERIENCE'],
  ['Unity-разработчик', ['Unity', 'C#', 'Git'], 'FULL_TIME', 'JUNIOR'],
  ['Data Engineer', ['Python', 'SQL', 'Docker', 'Airflow'], 'FULL_TIME', 'MIDDLE'],
  ['Фриланс-верстальщик', ['HTML', 'CSS', 'JavaScript'], 'FREELANCE', 'NO_EXPERIENCE'],
  ['Ассистент проектного офиса', ['Excel', 'Управление проектами'], 'PART_TIME', 'NO_EXPERIENCE'],
]

const DESCRIPTIONS = [
  'Работа в небольшой команде с ментором. Ревью кода, парное программирование, никакого «разберись сам».',
  'Реальные задачи с первого месяца: свой кусок продукта, а не тестовые песочницы. Гибкое начало дня.',
  'Ищем человека, которому интересно разбираться в чужом коде и задавать вопросы. Опыт коммерческой работы не обязателен.',
  'Продукт живёт под нагрузкой, поэтому важны тесты и аккуратность. Научим тому, чего не хватает.',
  'Команда распределённая, созвоны дважды в неделю. Ценим письменную коммуникацию и самостоятельность.',
  'Половина времени — продуктовые задачи, половина — технический долг. Честно предупреждаем сразу.',
]

const EMPLOYER_NAMES = [
  ['Дана', 'Сериккызы'],
  ['Арман', 'Тлеубаев'],
  ['Айгерим', 'Оспанова'],
  ['Тимур', 'Калиев'],
  ['Сабина', 'Нургалиева'],
  ['Ержан', 'Абишев'],
  ['Камила', 'Досанова'],
  ['Данияр', 'Сериков'],
  ['Асем', 'Кенжебаева'],
  ['Олжас', 'Мухамеджанов'],
  ['Динара', 'Искакова'],
  ['Бекзат', 'Оразбаев'],
  ['Жанар', 'Бектурова'],
  ['Мирас', 'Садыков'],
  ['Лаура', 'Алимбаева'],
]

const STUDENT_ABOUT = [
  'Учусь на третьем курсе, делаю пет-проекты и хочу стажировку, где можно писать код под присмотром ментора.',
  'Интересуют данные и аналитика. Прошла несколько курсов, считаю метрики для студенческого проекта.',
  'Люблю разбираться, как всё устроено внутри. Ищу команду, где не страшно задавать вопросы.',
  'Второй год веду небольшой проект в вузе: от идеи до релиза. Хочу увидеть, как это делают в продакшене.',
  'Ищу частичную занятость, совмещаю с учёбой. Готова к удалёнке и к гибридному формату.',
  null,
]

const EVENT_TITLES = [
  ['Ярмарка вакансий «Алатау 2026»', 'CAREER_FAIR'],
  ['Воркшоп: как написать первое резюме', 'WORKSHOP'],
  ['День собеседований с ИТ-компаниями', 'INTERVIEW_DAY'],
  ['Презентация Kaspi Lab', 'COMPANY_PRESENTATION'],
  ['Хакатон «Цифровой Казахстан»', 'HACKATHON'],
  ['Воркшоп по техническому интервью', 'WORKSHOP'],
  ['Осенняя ярмарка стажировок', 'CAREER_FAIR'],
  ['Презентация Astana Cloud', 'COMPANY_PRESENTATION'],
  ['День карьеры для выпускников', 'CAREER_FAIR'],
  ['Хакатон по компьютерному зрению', 'HACKATHON'],
  ['Воркшоп: портфолио разработчика', 'WORKSHOP'],
  ['Интервью-день Altyn Bank', 'INTERVIEW_DAY'],
]

const FUNNEL = [
  'SUBMITTED',
  'VIEWED',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
]
// Реалистичная воронка: большинство откликов застревает в начале.
const FUNNEL_WEIGHTS = [30, 22, 14, 10, 5, 4, 12, 3]

function pickStatus() {
  const total = FUNNEL_WEIGHTS.reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (let i = 0; i < FUNNEL.length; i++) {
    roll -= FUNNEL_WEIGHTS[i]
    if (roll <= 0) return FUNNEL[i]
  }
  return 'SUBMITTED'
}

/** Путь по воронке до статуса — для истории переходов. */
function pathTo(status) {
  const order = ['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED']
  const index = order.indexOf(status)
  if (index >= 0) return order.slice(0, index + 1)
  // Отказ и отзыв случаются с любого промежуточного шага.
  const cut = randInt(1, 3)
  return [...order.slice(0, cut), status]
}

async function insertMany(model, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await model.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true })
  }
  return rows.length
}

// ── Основной сценарий ────────────────────────────────────────────────────────

async function main() {
  const uni1 = await prisma.university.findFirst({
    where: { id: 'seed-university-001' },
    select: { id: true, name: true },
  })
  if (!uni1) throw new Error('Нет базового вуза. Сначала: pnpm db:seed')

  const passwordHash = await bcrypt.hash(PASSWORD, 12)

  await cleanup()

  const uni2 = await secondUniversity(passwordHash)
  const universities = [uni1, uni2]

  const admins = await prisma.user.findMany({
    where: { role: 'UNIVERSITY_ADMIN' },
    select: { id: true, universityId: true },
  })
  const adminOf = (universityId) => admins.find((a) => a.universityId === universityId)?.id ?? null

  const companies = await seedCompanies(passwordHash)
  const access = await seedAccess(companies, universities, adminOf)
  const vacancies = await seedVacancies(companies, access, adminOf)
  const students = await seedProfiles(universities)
  await seedApplications(vacancies, students)
  await seedEvents(universities)
  await seedResumes(students)

  await report()
}

/**
 * Удаляем только своё: всё с префиксом seed-career-, а также записи ранней версии этого
 * сида (`seed-company-…`, `seed-vacancy-…`). Без второго условия старая компания держит
 * slug, новая молча пропускается по skipDuplicates, и связи падают по внешнему ключу.
 */
async function cleanup() {
  const legacy = ['seed-company-', 'seed-vacancy-']
  for (const prefix of legacy) {
    await prisma.careerApplicationEvent.deleteMany({
      where: {
        application: {
          OR: [{ companyId: { startsWith: prefix } }, { vacancyId: { startsWith: prefix } }],
        },
      },
    })
    await prisma.careerApplication.deleteMany({
      where: { OR: [{ companyId: { startsWith: prefix } }, { vacancyId: { startsWith: prefix } }] },
    })
    await prisma.vacancyUniversityReview.deleteMany({
      where: { vacancyId: { startsWith: prefix } },
    })
    await prisma.vacancy.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.companyUniversityAccess.deleteMany({
      where: { companyId: { startsWith: prefix } },
    })
    await prisma.companyMember.deleteMany({ where: { companyId: { startsWith: prefix } } })
    await prisma.company.deleteMany({ where: { id: { startsWith: prefix } } })
  }
  // Работодатель из ранней версии сида.
  await prisma.user.deleteMany({ where: { email: 'employer@demo.kz' } })

  await prisma.careerApplicationEvent.deleteMany({
    where: { applicationId: { startsWith: PREFIX } },
  })
  await prisma.careerApplication.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.vacancyUniversityReview.deleteMany({ where: { vacancyId: { startsWith: PREFIX } } })
  await prisma.vacancy.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.companyUniversityAccess.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.companyMember.deleteMany({ where: { companyId: { startsWith: PREFIX } } })
  await prisma.company.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.eventParticipant.deleteMany({ where: { eventId: { startsWith: PREFIX } } })
  await prisma.event.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } })
}

/**
 * Второй активный вуз со своими студентами.
 *
 * Без него мультивузовость не проверить: главное правило модуля — компания видит студентов
 * только допустивших её вузов, а вакансия показывается лишь там, где её одобрили.
 */
async function secondUniversity(passwordHash) {
  const uni = await prisma.university.upsert({
    where: { id: UNI2_ID },
    update: { status: 'ACTIVE' },
    create: {
      id: UNI2_ID,
      name: 'Университет «Тұран-Астана»',
      shortName: 'Тұран-Астана',
      status: 'ACTIVE',
      country: 'KZ',
      city: '710000000',
    },
    select: { id: true, name: true },
  })

  const faculty = await prisma.faculty.upsert({
    where: { id: `${PREFIX}faculty-1` },
    update: {},
    create: {
      id: `${PREFIX}faculty-1`,
      name: 'Факультет информационных технологий',
      universityId: uni.id,
    },
    select: { id: true },
  })
  const group = await prisma.group.upsert({
    where: { id: `${PREFIX}group-1` },
    update: {},
    create: { id: `${PREFIX}group-1`, name: 'ИС-24-1', facultyId: faculty.id, year: 2024 },
    select: { id: true },
  })

  const names = [
    ['Айсұлу', 'Жақсылық'],
    ['Нұрсұлтан', 'Қайрат'],
    ['Мадина', 'Ерболқызы'],
    ['Ерасыл', 'Тұрған'],
    ['Аружан', 'Сағындық'],
    ['Санжар', 'Бейбіт'],
    ['Дильназ', 'Мұрат'],
    ['Абылай', 'Серік'],
    ['Томирис', 'Асқар'],
    ['Диас', 'Нұрлан'],
    ['Инжу', 'Бақыт'],
    ['Мирас', 'Дәулет'],
  ]
  const admin = {
    id: `${PREFIX}uni2-admin`,
    email: 'admin@turan-astana.demo.kz',
    passwordHash,
    firstName: 'Гүлнар',
    lastName: 'Сапарова',
    role: 'UNIVERSITY_ADMIN',
    universityId: uni.id,
  }
  const students = names.map(([firstName, lastName], i) => ({
    id: `${PREFIX}uni2-stu-${i}`,
    email: `st.ta.${i}@turan-astana.demo.kz`,
    passwordHash,
    firstName,
    lastName,
    role: 'STUDENT',
    universityId: uni.id,
    facultyId: faculty.id,
    groupId: group.id,
    course: randInt(2, 4),
    specialty: 'Информационные системы',
    graduationYear: 2027 + randInt(0, 2),
    skills: pickMany(
      ['React', 'TypeScript', 'Python', 'SQL', 'Git', 'Docker', 'Figma'],
      randInt(2, 5),
    ),
    languages: ['Русский', 'Қазақша'],
  }))

  await insertMany(prisma.user, [admin, ...students])
  return uni
}

async function seedCompanies(passwordHash) {
  const rows = []
  const members = []

  COMPANIES.forEach(([name, slug, description], i) => {
    const id = `${PREFIX}company-${i}`
    // Разные состояния: активные, одна ждёт подтверждения почты, одна заблокирована
    // платформой — чтобы было видно, как выглядит каждая.
    const status = i === 13 ? 'PENDING_EMAIL' : i === 14 ? 'BLOCKED' : 'ACTIVE'
    rows.push({
      id,
      name: `ТОО «${name}»`,
      slug,
      description,
      website: `https://${slug}.example.kz`,
      city: pick(CITIES),
      status,
      ...(status === 'BLOCKED'
        ? { blockedReason: 'Массовая рассылка вакансий не по профилю', blockedAt: new Date() }
        : {}),
    })

    const [firstName, lastName] = EMPLOYER_NAMES[i]
    members.push({
      user: {
        id: `${PREFIX}employer-${i}`,
        email: `hr${i}@${slug}.demo.kz`,
        passwordHash,
        firstName,
        lastName,
        role: 'EMPLOYER',
        profileVisibility: 'PRIVATE',
      },
      member: {
        id: `${PREFIX}member-${i}`,
        companyId: id,
        userId: `${PREFIX}employer-${i}`,
        role: 'OWNER',
      },
    })
  })

  await insertMany(prisma.company, rows)
  await insertMany(
    prisma.user,
    members.map((m) => m.user),
  )
  await insertMany(
    prisma.companyMember,
    members.map((m) => m.member),
  )

  // Владельцы проставляются вторым шагом: на момент создания компании юзера ещё нет.
  for (const [i] of COMPANIES.entries()) {
    await prisma.company.update({
      where: { id: `${PREFIX}company-${i}` },
      data: { createdById: `${PREFIX}employer-${i}` },
    })
  }
  return rows
}

/** Допуски: у каждого вуза свой набор одобренных, ожидающих и отклонённых компаний. */
async function seedAccess(companies, universities, adminOf) {
  const rows = []
  const active = companies.filter((c) => c.status === 'ACTIVE')

  universities.forEach((uni, uniIndex) => {
    active.forEach((company, i) => {
      // Первый вуз допускает больше компаний, второй — меньше: так видно, что вакансия
      // видна студентам одного вуза и не видна другому.
      const roll = rng()
      let status
      if (uniIndex === 0)
        status =
          roll < 0.7 ? 'APPROVED' : roll < 0.85 ? 'REQUESTED' : roll < 0.95 ? 'REJECTED' : 'REVOKED'
      else status = roll < 0.35 ? 'APPROVED' : roll < 0.7 ? 'REQUESTED' : 'REJECTED'

      rows.push({
        id: `${PREFIX}access-${uniIndex}-${i}`,
        companyId: company.id,
        universityId: uni.id,
        status,
        message: chance(0.7) ? 'Ищем стажёров и джунов на ИТ-направления.' : null,
        requestedById: `${PREFIX}employer-${companies.indexOf(company)}`,
        requestedAt: daysFromNow(-randInt(5, 90)),
        ...(status === 'APPROVED' || status === 'REJECTED' || status === 'REVOKED'
          ? { decidedById: adminOf(uni.id), decidedAt: daysFromNow(-randInt(1, 30)) }
          : {}),
        ...(status === 'REJECTED'
          ? { reason: 'Профиль компании не совпадает с направлениями вуза' }
          : {}),
        ...(status === 'REVOKED' ? { reason: 'Жалобы студентов на условия стажировки' } : {}),
        // У части допусков — срок до конца учебного года.
        ...(status === 'APPROVED' && chance(0.25)
          ? { expiresAt: daysFromNow(randInt(60, 300)) }
          : {}),
      })
    })
  })

  await insertMany(prisma.companyUniversityAccess, rows)
  return rows
}

async function seedVacancies(companies, access, adminOf) {
  const approvedByCompany = new Map()
  for (const a of access) {
    if (a.status !== 'APPROVED') continue
    const list = approvedByCompany.get(a.companyId) ?? []
    list.push(a.universityId)
    approvedByCompany.set(a.companyId, list)
  }

  const vacancies = []
  const reviews = []
  let n = 0

  for (const company of companies) {
    if (company.status !== 'ACTIVE') continue
    const unis = approvedByCompany.get(company.id) ?? []
    const count = unis.length > 0 ? randInt(3, 7) : randInt(1, 2)

    for (let k = 0; k < count; k++) {
      const [title, skills, employmentType, experienceLevel] = pick(ROLES)
      const id = `${PREFIX}vacancy-${n++}`
      const salaryMin = randInt(3, 12) * 50_000
      // У части вакансий зарплата не указана — фильтр «от» должен это учитывать.
      const withSalary = chance(0.75)

      vacancies.push({
        id,
        companyId: company.id,
        title,
        description: `${pick(DESCRIPTIONS)}\n\nЧто делать: участвовать в разработке продукта, писать код и тесты, участвовать в ревью. Что нужно: базовое знание перечисленных технологий и желание разбираться.`,
        employmentType,
        workFormat: pick(['ONSITE', 'HYBRID', 'REMOTE']),
        experienceLevel,
        city: chance(0.85) ? pick(CITIES) : null,
        salaryMin: withSalary ? salaryMin : null,
        salaryMax: withSalary ? salaryMin + randInt(1, 6) * 50_000 : null,
        salaryCurrency: withSalary ? 'KZT' : null,
        skills,
        languages: chance(0.5) ? ['Русский'] : ['Русский', 'English'],
        deadline: chance(0.4) ? daysFromNow(randInt(7, 90)) : null,
        // Большинство опубликовано; часть — черновики и снятые, чтобы у работодателя
        // было видно все состояния.
        status: chance(0.75) ? 'PUBLISHED' : pick(['DRAFT', 'PAUSED', 'CLOSED']),
        publishedAt: daysFromNow(-randInt(1, 60)),
        createdById: `${PREFIX}employer-${companies.indexOf(company)}`,
        views: randInt(0, 400),
      })

      for (const universityId of unis) {
        // Смесь решений: одобренные видны студентам, ожидающие лежат в очереди у вуза.
        const roll = rng()
        const status = roll < 0.65 ? 'APPROVED' : roll < 0.9 ? 'PENDING' : 'REJECTED'
        reviews.push({
          id: `${PREFIX}review-${reviews.length}`,
          vacancyId: id,
          universityId,
          status,
          ...(status === 'REJECTED'
            ? { reason: 'Требования не соответствуют уровню студентов' }
            : {}),
          ...(status !== 'PENDING'
            ? { decidedById: adminOf(universityId), decidedAt: daysFromNow(-randInt(1, 20)) }
            : {}),
        })
      }
    }
  }

  await insertMany(prisma.vacancy, vacancies)
  await insertMany(prisma.vacancyUniversityReview, reviews)
  return { vacancies, reviews }
}

/** Карьерные профили с разной полнотой — чтобы «готовность» была разной у всех. */
async function seedProfiles(universities) {
  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      deletedAt: null,
      universityId: { in: universities.map((u) => u.id) },
    },
    select: { id: true, universityId: true, skills: true },
    take: 400,
  })

  const chosen = students.filter(() => chance(0.55))
  const profiles = chosen.map((student) => {
    const level = rng()
    return {
      userId: student.id,
      // Часть профилей скрыта — работодатель не должен их видеть.
      visibility: level > 0.25 ? 'EMPLOYERS' : 'HIDDEN',
      employmentStatus: pick(['LOOKING', 'LOOKING', 'OPEN', 'NOT_LOOKING']),
      desiredPositions:
        level > 0.4
          ? pickMany(
              ROLES.map((r) => r[0]),
              randInt(1, 3),
            )
          : [],
      employmentTypes:
        level > 0.3 ? pickMany(['INTERNSHIP', 'PART_TIME', 'FULL_TIME'], randInt(1, 2)) : [],
      workFormats: level > 0.3 ? pickMany(['ONSITE', 'HYBRID', 'REMOTE'], randInt(1, 2)) : [],
      relocationReady: chance(0.3),
      desiredSalaryMin: level > 0.6 ? randInt(2, 8) * 50_000 : null,
      salaryCurrency: level > 0.6 ? 'KZT' : null,
      about: level > 0.5 ? pick(STUDENT_ABOUT) : null,
    }
  })

  await insertMany(prisma.careerProfile, profiles)

  // Навыки: без них процент совпадения у всех был бы нулевым.
  const skillPool = [
    'React',
    'TypeScript',
    'JavaScript',
    'Python',
    'SQL',
    'Git',
    'Docker',
    'HTML',
    'CSS',
    'Node.js',
    'Figma',
    'Тестирование',
    'Excel',
  ]
  for (const student of chosen) {
    if (student.skills.length >= 3) continue
    await prisma.user.update({
      where: { id: student.id },
      data: { skills: pickMany(skillPool, randInt(3, 7)) },
    })
  }

  // Согласия на чувствительные поля — у меньшинства, как и должно быть по умолчанию.
  const consents = []
  for (const student of chosen) {
    for (const field of ['GPA', 'PHONE', 'EMAIL']) {
      if (chance(0.18)) consents.push({ userId: student.id, field, companyId: null })
    }
  }
  await insertMany(prisma.careerConsent, consents)

  return chosen.map((s) => ({ id: s.id, universityId: s.universityId }))
}

async function seedApplications({ vacancies, reviews }, students) {
  // Откликнуться можно только на вакансию, одобренную вузом студента, — сид соблюдает
  // то же правило, что и API, иначе данные противоречили бы бизнес-логике.
  const visible = new Map()
  for (const review of reviews) {
    if (review.status !== 'APPROVED') continue
    const vacancy = vacancies.find((v) => v.id === review.vacancyId)
    if (!vacancy || vacancy.status !== 'PUBLISHED') continue
    const list = visible.get(review.universityId) ?? []
    list.push(vacancy.id)
    visible.set(review.universityId, list)
  }

  const applications = []
  const events = []
  const seen = new Set()

  for (const student of students) {
    const pool = visible.get(student.universityId) ?? []
    if (pool.length === 0) continue
    const count = Math.min(pool.length, randInt(0, 6))

    for (const vacancyId of pickMany(pool, count)) {
      const key = `${vacancyId}:${student.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const id = `${PREFIX}app-${applications.length}`
      const status = pickStatus()
      const createdAt = daysFromNow(-randInt(1, 45))
      const vacancy = vacancies.find((v) => v.id === vacancyId)

      applications.push({
        id,
        vacancyId,
        studentId: student.id,
        companyId: vacancy.companyId,
        universityId: student.universityId,
        status,
        coverLetter: chance(0.6)
          ? 'Здравствуйте! Учусь на профильной специальности, делала учебные и личные проекты. Готова начать со стажировки и учиться в процессе.'
          : null,
        createdAt,
      })

      // История переходов: без неё воронка выглядит так, будто ничего не происходило.
      const path = pathTo(status)
      path.forEach((toStatus, i) => {
        events.push({
          id: `${PREFIX}evt-${events.length}`,
          applicationId: id,
          fromStatus: i === 0 ? null : path[i - 1],
          toStatus,
          comment: toStatus === 'REJECTED' ? 'Выбрали кандидата с более близким опытом' : null,
          actorId: i === 0 ? student.id : `${PREFIX}employer-0`,
          createdAt: new Date(createdAt.getTime() + i * 86_400_000),
        })
      })
    }
  }

  await insertMany(prisma.careerApplication, applications)
  await insertMany(prisma.careerApplicationEvent, events)
}

/** Карьерные мероприятия — обычные события вуза с признаком careerKind. */
async function seedEvents(universities) {
  const organizers = await prisma.user.findMany({
    where: { role: 'UNIVERSITY_ADMIN' },
    select: { id: true, universityId: true },
  })

  const events = []
  universities.forEach((uni, uniIndex) => {
    const organizer = organizers.find((o) => o.universityId === uni.id)
    if (!organizer) return

    EVENT_TITLES.forEach(([title, kind], i) => {
      // Половина в прошлом, половина впереди — вкладки «предстоящие/прошедшие».
      const offset = i % 2 === 0 ? randInt(3, 60) : -randInt(3, 120)
      events.push({
        id: `${PREFIX}event-${uniIndex}-${i}`,
        organizerId: organizer.id,
        audience: 'UNIVERSITY',
        careerKind: kind,
        title,
        description:
          'Мероприятие карьерного центра. Регистрация обязательна, количество мест ограничено.',
        universityId: uni.id,
        location: chance(0.7) ? 'Главный корпус, актовый зал' : null,
        isOnline: chance(0.3),
        startsAt: daysFromNow(offset),
        endsAt: daysFromNow(offset),
      })
    })
  })

  await insertMany(prisma.event, events)

  // Участники: чтобы счётчик на карточке не был нулевым.
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', deletedAt: null },
    select: { id: true, universityId: true },
    take: 400,
  })
  const participants = []
  for (const event of events) {
    const pool = students.filter((s) => s.universityId === event.universityId)
    for (const student of pickMany(pool, Math.min(pool.length, randInt(3, 25)))) {
      participants.push({ eventId: event.id, userId: student.id })
    }
  }
  await insertMany(prisma.eventParticipant, participants)
}

/** Резюме: у части студентов включена публичная ссылка. */
async function seedResumes(students) {
  const rows = students
    .filter(() => chance(0.4))
    .map((student, i) => {
      const published = chance(0.5)
      return {
        userId: student.id,
        title: pick(['Резюме', 'Frontend-разработчик', 'Аналитик данных', 'QA-инженер']),
        publicSlug: published ? `demo${i}${Math.floor(rng() * 100000).toString(36)}` : null,
        publishedAt: published ? daysFromNow(-randInt(1, 30)) : null,
        includeContacts: published && chance(0.4),
      }
    })
  await insertMany(prisma.resume, rows)
}

async function report() {
  const [companies, access, vacancies, reviews, applications, profiles, resumes, events] =
    await Promise.all([
      prisma.company.count(),
      prisma.companyUniversityAccess.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.vacancy.count(),
      prisma.vacancyUniversityReview.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.careerApplication.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.careerProfile.groupBy({ by: ['visibility'], _count: { _all: true } }),
      prisma.resume.count({ where: { publicSlug: { not: null } } }),
      prisma.event.count({ where: { careerKind: { not: null } } }),
    ])

  const fmt = (rows, key) => rows.map((r) => `${r[key]}=${r._count._all}`).join(' ')

  console.log('\nКарьера — демо-данные готовы.\n')
  console.log(`  компаний:            ${companies}`)
  console.log(`  допусков к вузам:    ${fmt(access, 'status')}`)
  console.log(`  вакансий:            ${vacancies}`)
  console.log(`  решений по вакансиям:${fmt(reviews, 'status')}`)
  console.log(`  откликов:            ${fmt(applications, 'status')}`)
  console.log(`  карьерных профилей:  ${fmt(profiles, 'visibility')}`)
  console.log(`  публичных резюме:    ${resumes}`)
  console.log(`  карьерных событий:   ${events}`)
  console.log('\n  Входы (пароль у всех Admin1234!):')
  console.log('    работодатель:      hr0@alatau-soft.demo.kz')
  console.log('    админ 2-го вуза:   admin@turan-astana.demo.kz')
  console.log('    админ «Алатау»:    university-admin@studenthub.app')
  console.log('    студент «Алатау»:  student@studenthub.app\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
