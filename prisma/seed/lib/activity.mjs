// Нормы активности: сколько контента у человека, выводится из его роли и уровня активности,
// а не задаётся ручками «постов на пользователя».
//
// Зачем: при ручках «20–100 постов каждому» лента выглядела одинаково густой у всех — у
// первокурсника столько же публикаций, сколько у деканата, а у охранника — как у старосты.
// Здесь объём следует жизни: официальные аккаунты пишут больше всех, староста — больше
// однокурсников, охрана и библиотекарь почти молчат; внутри роли люди разные — треть
// почти ничего не публикует, пятая часть пишет за троих.
//
// Уровень активности — функция id человека (хэш), а не общего потока случайных чисел:
// один и тот же студент активен сразу во всём (посты, статьи, опросы, галерея), а шаги,
// которые обходят пользователей параллельно (57-user-media), получают тот же ответ.
// Итог воспроизводим: тот же id — та же активность в любом прогоне.

// Уровни активности: доля людей и множитель к норме роли. Средний множитель ≈ 1:
// 0,3·0,3 + 0,5·1 + 0,2·2,5 = 1,09 — норма роли и есть «среднее по роли».
export const ACTIVITY_LEVELS = [
  { name: 'passive', share: 0.3, k: 0.3 },
  { name: 'regular', share: 0.5, k: 1 },
  { name: 'active', share: 0.2, k: 2.5 },
]

/**
 * Норма роли — сколько в среднем у «обычного» человека за историю сида (около двух лет):
 * posts — публикации в ленте; articles, polls — статьи и опросы профиля; photos, videos —
 * личная галерея; postMedia — доля постов с вложениями.
 */
export const ROLE_NORMS = {
  STUDENT: { posts: 6, articles: 1, polls: 1, photos: 15, videos: 1, postMedia: 0.35 },
  // Староста ведёт группу: объявления, опросы «кто идёт», сборы.
  STAROSTA: { posts: 12, articles: 1, polls: 4, photos: 15, videos: 1, postMedia: 0.4 },
  TEACHER: { posts: 8, articles: 3, polls: 2, photos: 8, videos: 1, postMedia: 0.3 },
  DEAN: { posts: 14, articles: 2, polls: 2, photos: 6, videos: 1, postMedia: 0.45 },
  // Официальные аккаунты вуза: новости, события, поздравления — больше всех и с медиа.
  UNIVERSITY_ADMIN: { posts: 24, articles: 4, polls: 3, photos: 12, videos: 2, postMedia: 0.6 },
  UNIVERSITY_MODERATOR: { posts: 18, articles: 3, polls: 2, photos: 10, videos: 1, postMedia: 0.6 },
  SECURITY_GUARD: { posts: 0, articles: 0, polls: 0, photos: 2, videos: 0, postMedia: 0 },
  // Библиотекарь пишет редкие статьи («новые поступления»), в ленте не публикуется: шаг
  // постов (50-social) авторов этой роли не заводит.
  LIBRARIAN: { posts: 0, articles: 1, polls: 0, photos: 4, videos: 0, postMedia: 0 },
  EMPLOYER: { posts: 0, articles: 0, polls: 0, photos: 4, videos: 0, postMedia: 0 },
  PLATFORM_ADMIN: { posts: 0, articles: 0, polls: 0, photos: 6, videos: 1, postMedia: 0 },
  PLATFORM_MODERATOR: { posts: 0, articles: 0, polls: 0, photos: 6, videos: 1, postMedia: 0 },
}

/** Голосуют в опросе от 20 до 60 % тех, кому он виден (группа автора). */
export const POLL_TURNOUT = [0.2, 0.6]

// FNV-1a: быстрый и стабильный хэш строки в [0, 2^32). Соль разводит величины одного
// человека: иначе «много постов» и «много фото» были бы одним и тем же числом.
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const unit = (id, salt) => hash(`${salt}:${id}`) / 2 ** 32

/** Уровень активности человека — детерминированно по id. */
export function activityLevel(userId) {
  let u = unit(userId, 'level')
  for (const level of ACTIVITY_LEVELS) {
    if (u < level.share) return level
    u -= level.share
  }
  return ACTIVITY_LEVELS[ACTIVITY_LEVELS.length - 1]
}

/**
 * Сколько чего у человека: норма роли × множитель уровня × разброс ±30 %. Округление
 * вероятностное (2,4 → 2 в 60 % случаев, 3 в 40 %), иначе нормы меньше единицы
 * (статья в год у студента) округлялись бы в ноль у всех.
 */
export function activityOf(userId, role) {
  const norm = ROLE_NORMS[role] ?? ROLE_NORMS.STUDENT
  const level = activityLevel(userId)
  const count = (field) => {
    const jitter = 0.7 + 0.6 * unit(userId, `${field}:jitter`)
    const value = norm[field] * level.k * jitter
    const whole = Math.floor(value)
    return whole + (unit(userId, `${field}:round`) < value - whole ? 1 : 0)
  }
  const posts = count('posts')
  return {
    level: level.name,
    posts,
    articles: count('articles'),
    polls: count('polls'),
    photos: count('photos'),
    videos: count('videos'),
    // Постов с вложениями — доля от своих постов, не меньше одного у того, кто пишет.
    postMedia: posts === 0 ? 0 : Math.max(1, Math.round(posts * norm.postMedia)),
  }
}

/** Сколько проголосует в опросе: доля от тех, кому он виден — по POLL_TURNOUT. */
export function pollTurnout(pollId, audienceSize) {
  const [min, max] = POLL_TURNOUT
  const share = min + (max - min) * unit(pollId, 'turnout')
  return Math.round(audienceSize * share)
}

/**
 * Среднее по роли с учётом уровней — для оценки объёма прогона до первой записи
 * (index.mjs). Разброс ±30 % симметричен и в среднем не меняет итог.
 */
export function averageOf(role, field) {
  const norm = ROLE_NORMS[role] ?? ROLE_NORMS.STUDENT
  return ACTIVITY_LEVELS.reduce((sum, l) => sum + l.share * l.k, 0) * norm[field]
}
