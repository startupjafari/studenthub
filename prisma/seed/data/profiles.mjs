// Построители профиля пользователя.
//
// Вынесены из шага «люди» отдельным модулем, потому что заполнять профиль нужно в двух
// местах: генератору вузов (130 тыс. человек) и основному сиду — для именованных
// dev-аккаунтов (student@, teacher@, dean@ и т.д.). Раньше второй набор оставался
// пустым: у аккаунтов, под которыми и заходят руками, не было ни телефона, ни био, ни
// курса, ни GPA. Копировать построители во второе место нельзя — они бы разъехались.

import {
  ACADEMIC_STATUSES,
  DORMITORIES,
  EDUCATION_LEVELS,
  FUNDING_TYPES,
  INTERESTS,
  LANGUAGES,
  OFFICE_HOURS,
  PROFILE_VISIBILITY,
  RESEARCH_INTERESTS,
  SKILLS,
  STAFF_BIOS,
  STAFF_HEADLINES,
  STREETS,
  STUDENT_BIOS,
  STUDENT_HEADLINES,
  STUDY_FORMS,
  TIMEZONES,
  phone,
  translit,
} from './people.mjs'

// Общая часть профиля — есть у любой роли.
export function commonProfile(p, random, { profile, cityName }) {
  const handle = `${translit(p.firstName)}_${translit(p.lastName)}`
  return {
    middleName: p.middleName,
    gender: p.gender,
    phone: phone(random),
    showPhone: random.chance(0.5),
    showEmail: random.chance(0.4),
    profileVisibility: random.pick(PROFILE_VISIBILITY),
    birthDate: null, // проставляется ролевой частью: у студентов и сотрудников разный возраст
    languages: random.sample(LANGUAGES, random.randInt(2, 4)),
    telegram: `@${handle}`,
    instagram: handle,
    website: random.chance(0.35) ? `https://${translit(p.lastName)}.kz` : null,
    timezone: profile.timezone ?? random.pick(TIMEZONES),
    country: 'Казахстан',
    address: `${cityName}, ${random.pick(STREETS)}, д. ${random.randInt(1, 140)}, кв. ${random.randInt(1, 180)}`, // prettier-ignore
    // Последняя активность: часть пользователей «онлайн недавно», часть давно не входила.
    lastSeenAt: random.randomDate(-45, 0),
    // Немного заблокированных: без них экраны модерации платформы и вуза пустые.
    // Доля маленькая (1%), чтобы не портить списки и счётчики.
    isBlocked: random.chance(0.01),
  }
}

export function studentProfile(p, random, { group, specialties, cityName, profile }) {
  const year = group.year
  const course = Math.max(1, Math.min(4, new Date().getUTCFullYear() - year + 1))
  const birthYear = year - random.randInt(17, 20)
  return {
    ...commonProfile(p, random, { profile, cityName }),
    birthDate: new Date(Date.UTC(birthYear, random.randInt(0, 11), random.randInt(1, 28))),
    bio: random.pick(STUDENT_BIOS),
    headline: random.pick(STUDENT_HEADLINES),
    course,
    enrollmentYear: year,
    graduationYear: year + 4,
    educationLevel: random.pick(EDUCATION_LEVELS),
    studyForm: random.pick(STUDY_FORMS),
    fundingType: random.pick(FUNDING_TYPES),
    specialty: random.pick(specialties),
    studentCardNumber: `${year}${random.randInt(10000, 99999)}`,
    academicStatus: random.pick(ACADEMIC_STATUSES),
    gpa: Number((2.0 + random.rng() * 2.0).toFixed(2)),
    interests: random.sample(INTERESTS, random.randInt(3, 6)),
    skills: random.sample(SKILLS, random.randInt(3, 7)),
    dormitory: random.chance(0.4) ? random.pick(DORMITORIES) : null,
  }
}

export function staffProfile(p, random, ctx) {
  const { template, profile, cityName } = ctx
  return {
    ...commonProfile(p, random, { profile, cityName }),
    birthDate: new Date(
      Date.UTC(new Date().getUTCFullYear() - random.randInt(28, 62), random.randInt(0, 11), random.randInt(1, 28)), // prettier-ignore
    ),
    bio: random.pick(STAFF_BIOS),
    headline: random.pick(STAFF_HEADLINES),
    department: template?.name ?? 'Административный корпус',
    subjects: template ? template.subjects.slice(0, random.randInt(1, 3)).map(([n]) => n) : [],
    officeRoom: `каб. ${random.randInt(100, 420)}`,
    officeHours: random.pick(OFFICE_HOURS),
    employeeNumber: `EMP-${random.randInt(10000, 99999)}`,
    researchInterests: random.pick(RESEARCH_INTERESTS),
    publicationsUrl: `https://scholar.example.kz/${translit(p.lastName)}`,
    appointmentDate: random.randomDate(-4000, -200),
    workPhone: `+7 (727) ${random.randInt(200, 399)}-${random.randInt(10, 99)}-${random.randInt(10, 99)}`, // prettier-ignore
  }
}
