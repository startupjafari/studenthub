// Шаг «работодатели» (общий, не по вузу): компании, их сотрудники-рекрутёры и вакансии.
//
// Почему общий: компания в модуле карьеры — сущность платформы, а не вуза. Она
// запрашивает доступ к нескольким вузам, и её вакансия проходит модерацию в каждом
// вузе отдельно. Если бы компании создавались внутри вуза, главное правило модуля
// («компания видит студентов только допустивших её вузов») было бы нечем проверить.
//
// Доступы к вузам и решения по вакансиям создаёт шаг 80 — уже внутри вуза.
//
// Страница компании (профиль в стиле профиля пользователя) заполнена целиком: размер
// (все COMPANY_SIZES по кругу), отрасль, год основания, контакты и соцсети в форматах
// OrgPageFieldsShape, логотип и обложка, медиа страницы. Картинки — ссылки на общий пул
// (фото — из шага 10, медиа страницы — образцы форматов), копий в хранилище нет.

import { createHash, randomUUID } from 'node:crypto'
import { COMPANY_NAMES, VACANCY_TITLES } from '../data/companies.mjs'
import { person, phone, translit } from '../data/people.mjs'
import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'
import { makeRandom } from '../lib/rng.mjs'

// Город компании и вакансии — код КАТО, а не название: UpdateCompanySchema и
// VacancyInputSchema принимают только код, и витрина фильтрует по нему (название в поле
// показывалось бы как есть и не попадало ни в один фильтр).
const CITIES = [
  ['750000000', 'Алматы'],
  ['710000000', 'Астана'],
  ['790000000', 'Шымкент'],
  ['351010000', 'Караганда'],
  ['151010000', 'Актобе'],
]
const COMPANY_SIZES = ['1_10', '11_50', '51_200', '201_1000', '1000_PLUS']
const INDUSTRIES = ['Информационные технологии', 'Финансы и банки', 'Телеком', 'Ритейл', 'Промышленность', 'Консалтинг'] // prettier-ignore
const STREETS = ['пр. Абая', 'ул. Достык', 'пр. Мангилик Ел', 'ул. Байтурсынова', 'пр. Республики']
// Вакансия уровня MIDDLE и договор подряда (CONTRACT) — их нет в справочнике названий, а
// значения в EXPERIENCE_LEVELS / EMPLOYMENT_TYPES есть.
const MIDDLE_VACANCY = ['Middle Backend-разработчик', 'CONTRACT', 'MIDDLE', ['Node.js', 'PostgreSQL', 'Docker']] // prettier-ignore
const PREFIX = 'seed-co'
const HOUR = 3_600_000
// Медиа страницы компании — только фото и видео (PROFILE_MEDIA_MIMES в profile-content).
const MEDIA_PER_COMPANY = 4

export async function seedCompanies(prisma, writer, { passwordHash, pool = null }) {
  // Свой генератор: компании не принадлежат вузу, но данные должны быть воспроизводимы.
  const random = makeRandom(777_001)
  const companies = []
  const photos = pool?.photos ?? []

  for (const [ci, [name, slug, description]] of COMPANY_NAMES.entries()) {
    const companyId = `${PREFIX}-${slug}`
    // Статусы — из COMPANY_STATUSES: PENDING_EMAIL (регистрация не подтверждена),
    // ACTIVE, BLOCKED. Нужны все три: у платформы есть экран модерации компаний.
    const status = ci % 11 === 0 ? 'PENDING_EMAIL' : ci % 17 === 0 ? 'BLOCKED' : 'ACTIVE'
    const [cityCode, cityName] = random.pick(CITIES)
    const handle = slug.replace(/-/g, '_')
    const photo = photos.length ? photos[ci % photos.length] : null
    const cover = photos.length > 1 ? photos[(ci + 7) % photos.length] : null
    await writer.add('company', {
      id: companyId,
      name,
      slug,
      description,
      website: `https://${slug}.example.kz`,
      city: cityCode,
      industry: INDUSTRIES[ci % INDUSTRIES.length],
      size: COMPANY_SIZES[ci % COMPANY_SIZES.length],
      foundedYear: 1995 + ((ci * 7) % 30),
      contactEmail: `hello@${slug}.example.kz`,
      contactPhone: phone(random),
      address: `г. ${cityName}, ${STREETS[ci % STREETS.length]}, ${10 + ci}`,
      telegram: `@${handle}_hr`,
      instagram: `https://instagram.com/${slug.replace(/-/g, '.')}`,
      linkedin: `https://linkedin.com/company/${slug}`,
      // Логотип и обложка — публичные ссылки на фото пула, как обложка профиля
      // пользователя в шаге 30. Не в бакете profile-covers: при замене картинки сервис
      // удаляет только свой прежний объект (removeOwnObject), объект пула не тронет.
      logoUrl: photo?.url ?? null,
      coverUrl: cover?.url ?? null,
      // Регистрация не подтверждена: в базе хэш одноразового токена из письма и его срок,
      // сам токен — случайный и нигде не хранится (как у сервиса).
      emailVerificationHash:
        status === 'PENDING_EMAIL' ? createHash('sha256').update(randomUUID()).digest('hex') : null,
      emailVerificationExpiresAt:
        status === 'PENDING_EMAIL' ? new Date(Date.now() + (ci % 2 === 0 ? 20 : -5) * HOUR) : null,
      status,
      blockedReason: status === 'BLOCKED' ? 'Жалобы на недостоверные вакансии' : null,
      blockedAt: status === 'BLOCKED' ? random.randomDate(-40, -5) : null,
      createdById: null,
    })

    // Рекрутёры: у части компаний двое — чтобы роли OWNER/RECRUITER были обе.
    const recruiterIds = []
    const recruiterCount = ci % 3 === 0 ? 2 : 1
    for (let ri = 0; ri < recruiterCount; ri += 1) {
      const recruiterId = `${companyId}-hr-${ri}`
      const p = person(ci * 2 + ri, random)
      recruiterIds.push(recruiterId)
      await writer.add('user', {
        id: recruiterId,
        email: `hr${ri}@${slug}.example.kz`,
        username: `hr${ri}.${translit(slug)}`,
        passwordHash,
        ...p,
        role: 'EMPLOYER',
        phone: phone(random),
        showPhone: true,
        bio: `Отвечаю за подбор в ${name}.`,
        headline: ri === 0 ? 'HR-директор' : 'Рекрутёр',
        position: ri === 0 ? 'HR-директор' : 'Рекрутёр',
        jobTitle: 'Работодатель',
        responsibilities: 'Публикация вакансий, работа с откликами студентов.',
        workPhone: phone(random),
        country: 'Казахстан',
        timezone: 'Asia/Almaty',
        languages: ['kz', 'ru'],
        profileVisibility: 'PUBLIC',
        lastSeenAt: random.randomDate(-10, 0),
      })
      // Настройки уведомлений — как у всех остальных ролей: экран настроек должен
      // показывать сохранённое состояние, а не дефолты.
      await writer.add('notificationSettings', {
        id: `${recruiterId}-ns`,
        userId: recruiterId,
        emailEnabled: true,
        pushEnabled: random.chance(0.5),
        messageEnabled: true,
        postEnabled: random.chance(0.5),
        eventEnabled: true,
        systemEnabled: true,
        scheduleChangeEnabled: false,
        appUpdateEnabled: true,
      })
      await writer.add('companyMember', {
        id: `${recruiterId}-m`,
        companyId,
        userId: recruiterId,
        role: ri === 0 ? 'OWNER' : 'RECRUITER',
      })
    }
    companies.push({ id: companyId, index: ci, name, slug, status, recruiterIds })
  }
  // Компании и рекрутёры — до вакансий (Vacancy.createdById → User).
  await writer.flush()

  // ── Вакансии ───────────────────────────────────────────────────────────────
  for (const company of companies) {
    company.vacancyIds = []
    const count = random.randInt(2, 5)
    for (let vi = 0; vi < count; vi += 1) {
      const [title, employmentType, experienceLevel, skills] =
        vi === 0 && company.index % 4 === 1
          ? MIDDLE_VACANCY
          : VACANCY_TITLES[(vi * 3 + company.slug.length) % VACANCY_TITLES.length]
      const vacancyId = `${company.id}-v${vi}`
      const withSalary = random.chance(0.7)
      const salaryMin = random.randInt(2, 8) * 50_000
      // Большинство опубликовано; часть — черновики и снятые, чтобы у работодателя
      // было видно все состояния.
      const status = random.chance(0.75) ? 'PUBLISHED' : random.pick(['DRAFT', 'PAUSED', 'CLOSED'])
      await writer.add('vacancy', {
        id: vacancyId,
        companyId: company.id,
        title,
        description:
          `${company.name} ищет специалиста в команду.\n\n` +
          'Что делать: участвовать в задачах команды, писать код или документацию, ' +
          'участвовать в ревью и планировании.\n\nЧто нужно: базовое знание ' +
          'перечисленных технологий и желание разбираться.',
        employmentType,
        workFormat: random.pick(['ONSITE', 'HYBRID', 'REMOTE']),
        experienceLevel,
        city: random.chance(0.85) ? random.pick(CITIES)[0] : null,
        salaryMin: withSalary ? salaryMin : null,
        salaryMax: withSalary ? salaryMin + random.randInt(1, 6) * 50_000 : null,
        salaryCurrency: withSalary ? 'KZT' : null,
        skills,
        languages: random.chance(0.5) ? ['Русский'] : ['Русский', 'English'],
        deadline: random.chance(0.4) ? random.daysFromNow(random.randInt(7, 90)) : null,
        status,
        publishedAt: status === 'DRAFT' ? null : random.randomDate(-60, -1),
        createdById: company.recruiterIds[0],
        views: random.randInt(0, 400),
      })
      if (status === 'PUBLISHED') company.vacancyIds.push(vacancyId)
    }
  }
  await writer.flush()

  // ── Медиа страницы компании ─────────────────────────────────────────────────
  // File с companyId в бакете profile-media: загрузил сотрудник (ownerId), принадлежит
  // компании — как attachToPage. Все форматы фото и видео по кругу. Без хранилища — нет.
  const nextMedia = formatCycler(
    formatSamples(pool?.formats, 'profileMedia', { categories: ['IMAGE', 'VIDEO'] }),
  )
  let mediaNo = 0
  for (const company of companies) {
    if (company.status !== 'ACTIVE') continue
    for (let mi = 0; mi < MEDIA_PER_COMPANY; mi += 1) {
      const sample = nextMedia()
      if (!sample) break
      await writer.add(
        'file',
        formatFileRow(sample, mediaNo++, {
          id: `${company.id}-media-${mi}`,
          ownerId: company.recruiterIds[mi % company.recruiterIds.length],
          companyId: company.id,
          createdAt: random.randomDate(-200, -5),
        }),
      )
    }
  }
  await writer.flush()

  console.log(
    `Работодатели: ${companies.length} компаний, ` +
      `${companies.reduce((sum, c) => sum + c.recruiterIds.length, 0)} рекрутёров, ` +
      `${companies.reduce((sum, c) => sum + c.vacancyIds.length, 0)} опубликованных вакансий`,
  )
  return companies
}
