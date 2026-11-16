// Медиа соцчасти: из чего собираются вложения постов, сторис, «Актуального», альбомов и
// обсуждений событий. Не шаг, а общий помощник шагов 50–57.
//
// ВСЁ — ССЫЛКИ НА ОБЩИЙ ПУЛ. Пара (bucket, key) у File не уникальна (миграция
// 20260929121630_files_shared_object_pool), а FileService удаляет объект только вместе с
// последней ссылкой. Поэтому вложение здесь — это новая строка File на уже загруженный
// объект: «у каждого поста своё фото» стоит строку в БД и ноль байт в хранилище. Старые
// ограничения сида («один файл — один пост», альбомы из среза пула) этим сняты.
//
// Источники:
//   • реальные фото пула (шаг 10): photos — бакет медиа профиля, imageSources — уменьшенные
//     копии в бакете постов;
//   • образцы форматов (шаг 12, lib/formats.mjs): по объекту каждого допустимого формата в
//     каждом бакете с вложениями — так в данных встречаются ВСЕ форматы, а не только jpeg.
//
// Бакет выбирается тот, куда пишет сам модуль API: посты и обсуждения событий — бакет
// постов (linkMedia/addComment проверяют bucket), сторис — бакет сторис (assertOwnMedia),
// «Актуальное» — свой бакет без TTL, альбомы — медиа профиля. Строка File в чужом бакете
// открылась бы, но не прошла бы ни одну проверку модуля при правке.

import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'

// Форматы медиа сторис — копия STORY_IMAGE_MIMES/STORY_VIDEO_MIMES из
// packages/shared-schemas/src/stories.ts: gif и quicktime сторис не принимает.
export const STORY_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
export const STORY_VIDEO_MIMES = ['video/mp4', 'video/webm']

// Расширение по mime: имя файла должно совпадать с типом, иначе «Скачать» отдаст photo.jpg
// с содержимым png.
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/** Строка File из источника пула. Остальное (id, ownerId, привязка, createdAt) — в extra. */
export function poolFileRow(src, n, extra) {
  const kind = src.mime?.startsWith('video/') ? 'video' : 'photo'
  return {
    bucket: src.bucket,
    key: src.key,
    mime: src.mime ?? 'image/jpeg',
    size: src.size,
    name: `${kind}-${n + 1}.${EXT[src.mime] ?? 'jpg'}`,
    // Постер видео общий с пулом: объект-обложка лежит в публичном бакете обложек.
    ...(src.posterKey ? { posterKey: src.posterKey } : {}),
    ...extra,
  }
}

// Источник «образец формата» и источник «фото пула» сводятся к одному виду: функция,
// которая по номеру отдаёт поля строки File.
const fromSample = (sample) => (n, extra) => formatFileRow(sample, n, extra)
const fromPool = (src) => (n, extra) => poolFileRow(src, n, extra)

// Круговой выбор из списка фабрик: детерминированно и с покрытием всех элементов.
function cycler(list) {
  let i = 0
  return () => (list.length === 0 ? null : list[i++ % list.length])
}

// Источники картинок постов (уменьшенные фото в бакете постов). Шаг медиа кладёт их в пул,
// но пул, собранный из базы (SEED_ONLY=universities), их не содержит — тогда читаем строки
// источников сами. Один запрос на процесс: вузы идут параллельно, а список общий.
let imageSourcesPromise = null
async function loadImageSources(prisma, pool) {
  if (!pool) return []
  if (pool.imageSources?.length) return pool.imageSources
  imageSourcesPromise ??= prisma.file.findMany({
    where: { id: { startsWith: 'seed-media-src-' } },
    select: { bucket: true, key: true, mime: true, size: true },
    orderBy: { id: 'asc' },
    take: 2000,
  })
  return imageSourcesPromise
}

/**
 * Медиа постов (бакет постов): фото, картинки других форматов, gif и видео. Только IMAGE и
 * VIDEO — редактор поста принимает `image/*,video/*`, документов в постах нет.
 *
 * `layout(n)` — набор вложений n-го поста с медиа. Раскладки идут по кругу, поэтому в
 * каждом вузе есть и одиночное фото, и альбом, и gif, и видео, и смешанный альбом.
 */
export async function postMediaKit(prisma, pool) {
  const formats = pool?.formats ?? null
  const photos = (await loadImageSources(prisma, pool)).map(fromPool)
  const images = formatSamples(formats, 'posts', { categories: ['IMAGE'] })
    .filter((s) => s.role !== 'gif')
    .map(fromSample)
  const gifs = formatSamples(formats, 'posts', { roles: ['gif'] }).map(fromSample)
  const videos = formatSamples(formats, 'posts', { categories: ['VIDEO'] }).map(fromSample)
  const next = {
    photo: cycler(photos.length > 0 ? photos : images),
    image: cycler(images.length > 0 ? images : photos),
    gif: cycler(gifs),
    video: cycler(videos),
  }
  // Раскладки: одиночное фото, альбом из трёх, gif, видео, фото+видео, альбом из пяти.
  // Потолок поста — 10 вложений (CreatePostSchema.mediaIds); его показывает albumMax.
  const LAYOUTS = [
    ['photo'],
    ['photo', 'image', 'photo'],
    ['gif'],
    ['video'],
    ['photo', 'video'],
    ['photo', 'image', 'photo', 'image', 'photo'],
  ]
  const resolve = (kinds) => kinds.map((kind) => next[kind]()).filter(Boolean)
  return {
    empty: photos.length + images.length + videos.length === 0,
    layout: (n) => resolve(LAYOUTS[n % LAYOUTS.length]),
    albumMax: () => resolve(['photo', 'image', 'gif', 'photo', 'video', 'image', 'photo', 'image', 'video', 'photo']), // prettier-ignore
  }
}

/**
 * Медиа сторис и их копий в «Актуальном». Объекты образцов одинаковы во всех бакетах
 * (тот же файл под тем же ключом), поэтому копия в «Актуальном» берёт образец своего
 * бакета с тем же файлом — как сервер, который копирует объект при добавлении в подборку.
 */
export function storyMediaKit(pool) {
  const formats = pool?.formats ?? null
  const story = formatSamples(formats, 'stories', { mimes: [...STORY_IMAGE_MIMES, ...STORY_VIDEO_MIMES] }) // prettier-ignore
  const highlight = new Map(
    formatSamples(formats, 'storyHighlights', { mimes: [...STORY_IMAGE_MIMES, ...STORY_VIDEO_MIMES] }).map((s) => [s.file, s]), // prettier-ignore
  )
  return {
    image: formatCycler(story.filter((s) => s.category === 'IMAGE')),
    video: formatCycler(story.filter((s) => s.category === 'VIDEO')),
    highlightImage: formatCycler([...highlight.values()].filter((s) => s.category === 'IMAGE')),
    /** Образец «Актуального» для копии медиа живой сторис (тот же файл). */
    highlightOf: (sample) => highlight.get(sample.file) ?? null,
  }
}

/**
 * Медиа альбомов профиля (бакет медиа профиля): реальные фото и видео пула плюс образцы
 * всех форматов изображений и видео, которые принимает профиль (PROFILE_MEDIA_MIMES —
 * IMAGE и VIDEO целиком, включая gif и quicktime).
 */
export function albumMediaKit(pool) {
  const formats = pool?.formats ?? null
  const photos = (pool?.photos ?? []).map((src) => ({ make: fromPool(src), photo: true }))
  const videos = (pool?.videos ?? []).map((src) => ({ make: fromPool(src), photo: false }))
  const samples = formatSamples(formats, 'profileMedia', { categories: ['IMAGE', 'VIDEO'] }).map(
    (s) => ({ make: fromSample(s), photo: s.category === 'IMAGE' }),
  )
  return {
    empty: photos.length + videos.length + samples.length === 0,
    photo: cycler(photos.length > 0 ? photos : samples.filter((s) => s.photo)),
    sample: cycler(samples),
    video: cycler(videos.length > 0 ? videos : samples.filter((s) => !s.photo)),
  }
}

/**
 * Вложения комментария к событию (бакет постов). Обсуждение устроено как чат: фото, видео,
 * файл, голосовое (events.service, addComment). Архивы — категория «по приглашению», модуль
 * событий её не включает, поэтому их здесь нет.
 */
export function eventCommentMediaKit(pool) {
  const formats = pool?.formats ?? null
  const pick = (opts) => formatCycler(formatSamples(formats, 'posts', opts))
  return {
    image: pick({ categories: ['IMAGE'] }),
    video: pick({ categories: ['VIDEO'] }),
    document: pick({ categories: ['DOCUMENT'] }),
    voice: pick({ roles: ['voice'] }),
    music: pick({ roles: ['music'] }),
  }
}

// ── Наборы сторис ──────────────────────────────────────────────────────────────
// Копии закрытых списков packages/shared-schemas/src/stories.ts: генератор работает на
// чистом node и не тянет собранные пакеты. Менять только вместе с источником.
export const STORY_BACKGROUNDS = ['sunset', 'ocean', 'forest', 'grape', 'graphite', 'rose']
export const STORY_REACTION_EMOJIS = ['❤️', '🔥', '👏', '😮', '😢']
export const STORY_FONTS = ['sans', 'serif', 'mono']
export const STORY_TEXT_COLORS = ['#ffffff', '#0f1115', '#2b72e5', '#facc15', '#ef4444', '#22c55e']
export const STORY_TEXT_ALIGNS = ['left', 'center', 'right']
export const STORY_TEXT_BACKGROUNDS = ['none', 'solid', 'soft']
export const STORY_TTL_MS = 24 * 3_600_000

// Положение элемента на кадре по номеру: доли кадра 0..1, масштаб 0.4..3, поворот ±180
// (storyPlacement в StoryElementSchema). От номера, а не от PRNG: элементы общих авторов
// (платформа, компании) пишутся из каждого вуза и обязаны совпадать до байта.
export function storyPlacement(n, slot = 0) {
  return {
    x: 0.3 + ((n + slot) % 5) * 0.1,
    y: 0.2 + ((n + slot * 2) % 4) * 0.18,
    scale: 0.8 + (n % 5) * 0.3,
    rotation: ((n % 7) - 3) * 6,
  }
}

/**
 * Текстовый элемент редактора. Стиль идёт по кругу независимыми «колёсами»: цвет — каждый
 * номер, шрифт — каждый, выравнивание — каждые три, подложка — каждые девять. За два
 * десятка сторис вуза встречаются все цвета, шрифты, выравнивания и подложки.
 */
export function storyTextElement(n, text, slot = 0) {
  return {
    type: 'text',
    ...storyPlacement(n, slot),
    text,
    color: STORY_TEXT_COLORS[n % STORY_TEXT_COLORS.length],
    font: STORY_FONTS[n % STORY_FONTS.length],
    align: STORY_TEXT_ALIGNS[Math.floor(n / 3) % STORY_TEXT_ALIGNS.length],
    background: STORY_TEXT_BACKGROUNDS[Math.floor(n / 9) % STORY_TEXT_BACKGROUNDS.length],
  }
}

export function storyEmojiElement(n, slot = 0) {
  return {
    type: 'emoji',
    ...storyPlacement(n, slot),
    emoji: STORY_REACTION_EMOJIS[n % STORY_REACTION_EMOJIS.length],
  }
}
