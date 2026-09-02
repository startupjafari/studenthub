// Детерминированные идентификаторы.
//
// Правило: id строки полностью определяется её местом в структуре (вуз → факультет →
// группа → студент), а не порядком генерации. Это и есть механизм идемпотентности:
// повторный прогон формирует те же id, и createMany({ skipDuplicates }) их пропускает.
//
// Формат: `u07-f2-g03-st012` — читается глазами в psql и в UI, и по префиксу видно,
// что строка создана сидом (а не человеком через интерфейс).
//
// СОВМЕСТИМОСТЬ: вуз №1 — это существующий демо-вуз с историческими id
// (`seed-university-001`, `seed-faculty-001`, `seed-group-001`, `seed-course-001`).
// На них ссылаются docs/PROJECT.md §14, e2e-тесты и dev-инвайт, поэтому переименовать
// их нельзя: legacyIds() отдаёт исторический id там, где он есть.

export const DEMO_UNIVERSITY_ID = 'seed-university-001'
export const DEMO_FACULTY_ID = 'seed-faculty-001'
export const DEMO_GROUP_ID = 'seed-group-001'
export const DEMO_TERM_ID = 'seed-term-001'
export const DEMO_SUBJECT_ID = 'seed-subject-001'
export const DEMO_COURSE_ID = 'seed-course-001'

// Индекс вуза 1..N → префикс. Ширина 3 знака держит лексикографический порядок id
// таким же, как числовой (u007 < u010), — сортировка в psql не путается.
export function uniPrefix(index) {
  return `u${String(index).padStart(3, '0')}`
}

// id вуза: №1 остаётся демо-вузом, остальные — по префиксу.
export function universityId(index) {
  return index === 1 ? DEMO_UNIVERSITY_ID : uniPrefix(index)
}

export function facultyId(index, facIndex) {
  if (index === 1 && facIndex === 0) return DEMO_FACULTY_ID
  return `${uniPrefix(index)}-f${facIndex}`
}

export function groupId(index, facIndex, grpIndex) {
  if (index === 1 && facIndex === 0 && grpIndex === 1) return DEMO_GROUP_ID
  return `${uniPrefix(index)}-f${facIndex}-g${String(grpIndex).padStart(2, '0')}`
}

// Прочие сущности вуза: id(1, 'room', 4) → 'u001-room-4'. Единая точка, чтобы
// префиксы не расползались по шагам строковыми литералами.
export function id(index, kind, ...parts) {
  return [uniPrefix(index), kind, ...parts].join('-')
}

// Дочерняя сущность по id родителя: child('u001-f0-g03', 'st', 12) → 'u001-f0-g03-st12'.
export function child(parentId, kind, ...parts) {
  return [parentId, kind, ...parts].join('-')
}

// Email пользователя. Домен зависит от вуза: у демо-вуза — исторический alatau.edu.kz,
// у остальных — u{NN}.edu.kz. Уникальность гарантирована структурой (роль+индексы).
export function emailFor(index, local) {
  const domain = index === 1 ? 'alatau.edu.kz' : `${uniPrefix(index)}.edu.kz`
  return `${local}@${domain}`
}

// username хранится в нижнем регистре и уникален глобально (User.username @unique),
// поэтому в него входит префикс вуза.
export function usernameFor(index, local) {
  return `${local}.${uniPrefix(index)}`.toLowerCase().replace(/[^a-z0-9._]/g, '')
}
