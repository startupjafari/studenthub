// Шаг «карьера в вузе»: доступы компаний к вузу, модерация вакансий, карьерные профили
// студентов с резюме и согласиями, отклики с историей переходов.
//
// Правило модуля: компания видит студентов только тех вузов, которые её допустили, а
// вакансия показывается только там, где вуз её одобрил. Поэтому у каждого вуза свои
// решения: часть компаний одобрена, часть в очереди, часть отклонена и отозвана — иначе
// проверять нечего.
//
// Карьерный профиль, согласия и резюме — у КАЖДОГО студента (решение о глубине
// сателлитов), но «ищу работу» из них только часть: воронка должна быть реалистичной.

import { COVER_LETTERS, DESIRED_POSITIONS } from '../data/companies.mjs'
import { translit } from '../data/people.mjs'
import { child, id } from '../lib/ids.mjs'

// Реалистичная воронка: большинство откликов застревает в начале.
const FUNNEL = [
  ['SUBMITTED', 30],
  ['VIEWED', 22],
  ['SHORTLISTED', 14],
  ['INTERVIEW', 10],
  ['OFFER', 5],
  ['HIRED', 4],
  ['REJECTED', 12],
  ['WITHDRAWN', 3],
]
const FUNNEL_ORDER = ['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED']
// Большинство ждёт зарплату в тенге; остальные валюты — по одному на десяток студентов.
const SALARY_CURRENCIES = ['KZT', 'KZT', 'KZT', 'USD', 'KZT', 'KZT', 'EUR', 'KZT', 'RUB', 'KZT']
const KZT_PER_UNIT = { KZT: 1, USD: 500, EUR: 550, RUB: 5.5 }

// Путь по воронке до статуса — для истории переходов.
function pathTo(status, random) {
  const index = FUNNEL_ORDER.indexOf(status)
  if (index >= 0) return FUNNEL_ORDER.slice(0, index + 1)
  // Отказ и отзыв случаются с любого промежуточного шага.
  return [...FUNNEL_ORDER.slice(0, random.randInt(1, 3)), status]
}

export async function seedCareer(prisma, writer, ctx) {
  const { index, random, structure, people, companies } = ctx
  const { uniId } = structure
  if (!companies?.length) return

  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))

  // ── Доступ компаний к вузу ──────────────────────────────────────────────────
  // Каждому вузу — свой набор компаний (сдвиг по индексу вуза), чтобы вузы не были
  // копиями друг друга.
  const linked = []
  for (let k = 0; k < 6; k += 1) {
    const company = companies[(index * 3 + k) % companies.length]
    if (company.status !== 'ACTIVE') continue
    const status = random.pickWeighted([
      ['APPROVED', 70],
      ['REQUESTED', 15],
      ['REJECTED', 10],
      ['REVOKED', 5],
    ])
    const decided = status !== 'REQUESTED'
    await writer.add('companyUniversityAccess', {
      id: `${company.id}-acc-${uniId}`,
      companyId: company.id,
      universityId: uniId,
      status,
      message: 'Готовы брать студентов на стажировки и part-time.',
      requestedById: company.recruiterIds[0],
      requestedAt: random.randomDate(-120, -20),
      decidedById: decided ? people.adminId : null,
      decidedAt: decided ? random.randomDate(-19, -1) : null,
      reason: status === 'REJECTED' ? 'Нет подтверждения деятельности компании' : null,
      expiresAt: status === 'APPROVED' && random.chance(0.4) ? random.daysFromNow(365) : null,
    })
    if (status === 'APPROVED') linked.push(company)
  }

  // ── Модерация вакансий в вузе ───────────────────────────────────────────────
  const visibleVacancies = []
  for (const company of linked) {
    for (const vacancyId of company.vacancyIds) {
      const status = random.pickWeighted([
        ['APPROVED', 65],
        ['PENDING', 25],
        ['REJECTED', 10],
      ])
      await writer.add('vacancyUniversityReview', {
        id: `${vacancyId}-rev-${uniId}`,
        vacancyId,
        universityId: uniId,
        status,
        reason: status === 'REJECTED' ? 'Требования не соответствуют уровню студентов' : null,
        decidedById: status === 'PENDING' ? null : people.adminId,
        decidedAt: status === 'PENDING' ? null : random.randomDate(-20, -1),
      })
      if (status === 'APPROVED') visibleVacancies.push({ vacancyId, company })
    }
  }
  await writer.flush()

  // ── Карьерные профили, согласия и резюме — у всех студентов ─────────────────
  for (const [si, studentId] of allStudents.entries()) {
    const employmentStatus = random.pickWeighted([
      ['LOOKING', 35],
      ['OPEN', 40],
      ['NOT_LOOKING', 25],
    ])
    const hidden = employmentStatus === 'NOT_LOOKING' && random.chance(0.6)
    // Валюта ожиданий — по кругу (salaryCurrency: KZT|USD|EUR|RUB), суммы пересчитаны из
    // тенге по грубому курсу: «300 000 долларов» у студента выглядело бы ошибкой.
    const currency = SALARY_CURRENCIES[si % SALARY_CURRENCIES.length]
    const rate = KZT_PER_UNIT[currency]
    const kztMin = random.randInt(1, 6) * 50_000
    const kztMax = kztMin + random.randInt(1, 4) * 50_000
    const toCurrency = (kzt) => (rate === 1 ? kzt : Math.round(kzt / rate / 50) * 50)
    await writer.add('careerProfile', {
      id: child(studentId, 'cp'),
      userId: studentId,
      // CAREER_VISIBILITIES ровно два: HIDDEN и EMPLOYERS. Скрытый профиль компания
      // не видит — это состояние тоже должно встречаться.
      visibility: hidden ? 'HIDDEN' : 'EMPLOYERS',
      employmentStatus,
      desiredPositions: random.sample(DESIRED_POSITIONS, random.randInt(1, 3)),
      employmentTypes: random.sample(['INTERNSHIP', 'PART_TIME', 'FULL_TIME', 'CONTRACT', 'FREELANCE'], random.randInt(1, 3)), // prettier-ignore
      workFormats: random.sample(['ONSITE', 'HYBRID', 'REMOTE'], random.randInt(1, 3)),
      relocationReady: random.chance(0.35),
      desiredSalaryMin: toCurrency(kztMin),
      desiredSalaryMax: toCurrency(kztMax),
      salaryCurrency: currency,
      about: 'Готов совмещать работу с учёбой, интересны задачи по специальности.',
      // Готовность профиля — то же, что считает сервис: заполненность + портфолио.
      readinessScore: random.randInt(40, 100),
      readinessAt: random.randomDate(-30, 0),
    })

    // Согласия на передачу данных: GPA/телефон/почта, часть отозвана.
    for (const field of ['GPA', 'PHONE', 'EMAIL']) {
      if (!random.chance(0.7)) continue
      const revoked = random.chance(0.15)
      await writer.add('careerConsent', {
        id: child(studentId, 'cc', field.toLowerCase()),
        userId: studentId,
        field,
        // Согласие бывает и общим (companyId = null), и на конкретную компанию.
        companyId: random.chance(0.3) && linked.length > 0 ? random.pick(linked).id : null,
        grantedAt: random.randomDate(-100, -5),
        revokedAt: revoked ? random.randomDate(-4, -1) : null,
      })
    }

    // Резюме: у всех, но опубликовано по ссылке — не у всех.
    const published = random.chance(0.45)
    await writer.add('resume', {
      id: child(studentId, 'cv'),
      userId: studentId,
      title: `Резюме — ${random.pick(DESIRED_POSITIONS)}`,
      // publicSlug уникален глобально; собираем из id студента, он тоже уникален.
      publicSlug: published ? translit(studentId).replace(/[^a-z0-9]/g, '-') : null,
      publishedAt: published ? random.randomDate(-60, -1) : null,
      includeContacts: published && random.chance(0.5),
    })

    // ── Отклики: у части «ищущих» студентов ──────────────────────────────────
    if (visibleVacancies.length === 0 || employmentStatus === 'NOT_LOOKING') continue
    const applications = random.randInt(0, 3)
    for (let ai = 0; ai < applications; ai += 1) {
      const { vacancyId, company } = visibleVacancies[(si + ai) % visibleVacancies.length]
      const status = random.pickWeighted(FUNNEL)
      const applicationId = `${vacancyId}-app-${studentId}`
      const createdAt = random.randomDate(-50, -1)
      await writer.add('careerApplication', {
        id: applicationId,
        vacancyId,
        studentId,
        companyId: company.id,
        universityId: uniId,
        status,
        coverLetter: random.pick(COVER_LETTERS),
        createdAt,
      })
      // Журнал откликов — основание в споре, поэтому цепочка обязана сходиться: путь
      // считается один раз (у отказа и отзыва он случайный, и второй вызов давал другой
      // «предыдущий» статус), fromStatus — toStatus прошлого события, время идёт вперёд
      // от подачи и не уходит в будущее.
      const path = pathTo(status, random)
      let at = createdAt
      for (const [ei, toStatus] of path.entries()) {
        if (ei > 0) at = new Date(Math.min(Date.now(), at.getTime() + random.randInt(1, 72) * 3_600_000)) // prettier-ignore
        await writer.add('careerApplicationEvent', {
          id: child(applicationId, 'ev', ei),
          applicationId,
          fromStatus: ei === 0 ? null : path[ei - 1],
          toStatus,
          comment: toStatus === 'REJECTED' ? 'Выбрали другого кандидата' : null,
          // Подачу и отзыв делает студент, остальные переходы — работодатель.
          actorId: ei === 0 || toStatus === 'WITHDRAWN' ? studentId : company.recruiterIds[0],
          createdAt: at,
        })
      }
    }
  }

  // ── Карьерные мероприятия вуза ──────────────────────────────────────────────
  // Event.careerKind отличает карьерные события от обычных в календаре. По одному каждого
  // вида CAREER_EVENT_KINDS: фильтр «вид» в карьерном разделе иначе пуст на четырёх из пяти.
  // Одно — онлайн (ссылка и провайдер, как ставит сервер по хосту), одно — уже прошло
  // (фильтр «прошедшие»). Первое сохраняет прежний id `…-ev-career`: на него ссылаются
  // другие шаги.
  const host = linked[0]?.name ?? 'партнёров вуза'
  const careerEvents = [
    ['career', 'CAREER_FAIR', 'День карьеры', 'Встречи с работодателями, экспресс-интервью и разбор резюме.', { days: [5, 40] }], // prettier-ignore
    ['career-workshop', 'WORKSHOP', 'Мастер-класс: резюме и сопроводительное письмо', 'Разбираем резюме участников и типичные ошибки откликов.', { days: [3, 20], online: true }], // prettier-ignore
    ['career-interviews', 'INTERVIEW_DAY', 'День собеседований', 'Компании проводят первичные интервью со студентами из шорт-листа.', { days: [10, 30] }], // prettier-ignore
    ['career-presentation', 'COMPANY_PRESENTATION', `Презентация компании: ${host}`, 'Рассказ о стажировках, командах и пути от стажёра до разработчика.', { days: [7, 25] }], // prettier-ignore
    ['career-hackathon', 'HACKATHON', 'Студенческий хакатон', 'Сорок восемь часов, команды до пяти человек, задачи от партнёров.', { days: [-40, -10], hours: 48 }], // prettier-ignore
  ]
  for (const [ei, [suffix, careerKind, title, description, opts]] of careerEvents.entries()) {
    const eventId = id(index, 'ev', suffix)
    const startsAt = random.randomDate(opts.days[0], opts.days[1])
    await writer.add('event', {
      id: eventId,
      organizerId: people.adminId,
      audience: 'UNIVERSITY',
      title,
      description,
      careerKind,
      universityId: uniId,
      location: opts.online ? null : ['Актовый зал', 'Коворкинг библиотеки', 'Аудитория 101'][ei % 3], // prettier-ignore
      isOnline: Boolean(opts.online),
      // Провайдер ставит сервер по хосту ссылки (meetingProviderOf): zoom.us → ZOOM.
      meetingProvider: opts.online ? 'ZOOM' : null,
      meetingUrl: opts.online ? `https://zoom.us/j/${8_100_000_000 + index * 10 + ei}` : null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + (opts.hours ?? 3) * 3_600_000),
    })
    // Записавшиеся — часть студентов вуза: счётчик участников на карточке не нулевой.
    for (const [pi, userId] of allStudents.slice(ei * 7, ei * 7 + 12).entries()) {
      await writer.add('eventParticipant', {
        id: child(eventId, 'p', pi),
        eventId,
        userId,
        createdAt: new Date(Math.min(Date.now(), startsAt.getTime()) - random.randInt(1, 10) * 86_400_000), // prettier-ignore
      })
    }
  }

  await writer.flush()
}
