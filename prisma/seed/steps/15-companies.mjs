// Шаг «работодатели» (общий, не по вузу): компании, их сотрудники-рекрутёры и вакансии.
//
// Почему общий: компания в модуле карьеры — сущность платформы, а не вуза. Она
// запрашивает доступ к нескольким вузам, и её вакансия проходит модерацию в каждом
// вузе отдельно. Если бы компании создавались внутри вуза, главное правило модуля
// («компания видит студентов только допустивших её вузов») было бы нечем проверить.
//
// Доступы к вузам и решения по вакансиям создаёт шаг 80 — уже внутри вуза.

import { COMPANY_NAMES, VACANCY_TITLES } from '../data/companies.mjs'
import { person, phone, translit } from '../data/people.mjs'
import { makeRandom } from '../lib/rng.mjs'

const CITIES = ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе']
const PREFIX = 'seed-co'

export async function seedCompanies(prisma, writer, { passwordHash }) {
  // Свой генератор: компании не принадлежат вузу, но данные должны быть воспроизводимы.
  const random = makeRandom(777_001)
  const companies = []

  for (const [ci, [name, slug, description]] of COMPANY_NAMES.entries()) {
    const companyId = `${PREFIX}-${slug}`
    // Статусы — из COMPANY_STATUSES: PENDING_EMAIL (регистрация не подтверждена),
    // ACTIVE, BLOCKED. Нужны все три: у платформы есть экран модерации компаний.
    const status = ci % 11 === 0 ? 'PENDING_EMAIL' : ci % 17 === 0 ? 'BLOCKED' : 'ACTIVE'
    await writer.add('company', {
      id: companyId,
      name,
      slug,
      description,
      website: `https://${slug}.example.kz`,
      city: random.pick(CITIES),
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
        languages: ['kk', 'ru'],
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
    companies.push({ id: companyId, name, slug, status, recruiterIds })
  }
  // Компании и рекрутёры — до вакансий (Vacancy.createdById → User).
  await writer.flush()

  // ── Вакансии ───────────────────────────────────────────────────────────────
  for (const company of companies) {
    company.vacancyIds = []
    const count = random.randInt(2, 5)
    for (let vi = 0; vi < count; vi += 1) {
      const [title, employmentType, experienceLevel, skills] = VACANCY_TITLES[(vi * 3 + company.slug.length) % VACANCY_TITLES.length] // prettier-ignore
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
        city: random.chance(0.85) ? random.pick(CITIES) : null,
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

  console.log(
    `Работодатели: ${companies.length} компаний, ` +
      `${companies.reduce((sum, c) => sum + c.recruiterIds.length, 0)} рекрутёров, ` +
      `${companies.reduce((sum, c) => sum + c.vacancyIds.length, 0)} опубликованных вакансий`,
  )
  return companies
}
