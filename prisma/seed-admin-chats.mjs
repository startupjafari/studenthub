// Чаты платформенного администратора для ручной проверки клиентов: ~100 переписок по
// 200–400 сообщений, в которых встречается каждый вид сообщения, который умеет продукт.
//
// Запуск — тот же workflow «Seed (Railway)», что и основной сид: с локальной машины
// прод-БД недоступна (prisma/seed/lib/env.mjs, memory railway). Режимы те же:
//
//   SEED_MODE=seed    — долить чаты с меткой SEED_TAG;
//   SEED_MODE=cleanup — удалить ровно то, что налил прогон с этой меткой.
//
// ВИДЫ СООБЩЕНИЙ. Тип в базе не хранится (packages/shared-schemas/src/chats.ts): вид
// выводится при рендере из полей сообщения и его вложений. Поэтому генератор заполняет
// ровно эти поля и ничего не изобретает:
//   текст (простой, длинный, с разметкой, эмодзи, упоминание, ссылка с превью);
//   ответ (с цитатой и без), пересылка, правка, удаление, закреп, «тихое»;
//   фото, альбом, видео, медиа под спойлером, фото «без сжатия» (asDocument);
//   голосовое (имя `voice-…`), аудиофайл, документы (pdf, xlsx, csv, txt);
//   репост поста, пересланная история и ответ на неё, карточка профиля;
//   опрос (один ответ / несколько / анонимный / закрытый), реакции;
//   служебные события группы (11 типов), отложенные сообщения.
// Стикеров, GIF, геопозиции и контактов в продукте нет — их нет и здесь.
//
// ХРАНИЛИЩЕ. Пара (bucket, key) у File не уникальна (prisma/schema/08-files.prisma): один
// объект может стоять в тысяче сообщений. Поэтому в MinIO уходит небольшой набор (~25 МБ:
// фото, четыре ролика, голосовые, документы), а вложения — это строки File, которые на
// него ссылаются. Без хранилища (нет MINIO_*) прогон идёт дальше без медиа.
//
// Все id детерминированы и начинаются с `adm-<метка>-`: по этому префиксу уборка находит
// свои чаты и файлы и не трогает ничего чужого.

import { createRequire } from 'node:module'
import { PrismaClient } from '@prisma/client'
import { loadEnv } from './seed/lib/env.mjs'
import { makeRandom } from './seed/lib/rng.mjs'
import { createStorage } from './seed/lib/storage.mjs'
import { createWriter } from './seed/lib/writer.mjs'

const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL
const prisma = new PrismaClient()
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))

const MODE = process.env.SEED_MODE ?? 'seed'
const TAG = process.env.SEED_TAG ?? 'admin-chats'
if (!/^[A-Za-z0-9._-]{1,64}$/.test(TAG))
  throw new Error(`SEED_TAG «${TAG}»: только буквы, цифры, . _ -`)
const PREFIX = `adm-${TAG}-`
const OBJECT_PREFIX = `seed/admin-chats/${TAG}/`

const CHATS = Number(process.env.SEED_ADMIN_CHATS ?? 100)
const [MSG_MIN, MSG_MAX] = (process.env.SEED_ADMIN_CHAT_MESSAGES ?? '200-400')
  .split('-')
  .map(Number)
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@studenthub.app'
// Карточка профиля в чате узнаётся по ссылке на свой же веб (parseProfileShare).
const WEB_URL = (
  process.env.SEED_WEB_URL ?? 'https://studenthub-front-production.up.railway.app'
).replace(/\/$/, '')

const random = makeRandom(20261111)
const { randInt, pick, chance, sample, pickWeighted } = random

// ── Тексты ────────────────────────────────────────────────────────────────────

const GREETINGS = [
  'Привет!',
  'Добрый день!',
  'Здравствуйте!',
  'Привет, как дела?',
  'Доброе утро 👋',
  'Салем!',
]
const SHORT = [
  'Ок',
  'Понял',
  'Спасибо!',
  'Да',
  'Нет',
  'Хорошо',
  'Супер 🔥',
  'Договорились',
  'Сейчас посмотрю',
  'Минуту',
  'Принято',
  'Ага',
  'Ясно',
  'Отлично!',
  'Можно',
  'Не за что',
  '👍',
  'Сделаю',
  'Уже в пути',
]
const LINES = [
  'Посмотрите, пожалуйста, отчёт по вузам за неделю — там выросло число жалоб.',
  'Завтра в 10:00 созвон по запуску нового вуза, ссылку пришлю за полчаса.',
  'Модерация заявок на демо отстаёт, нужно разобрать хотя бы новые.',
  'Обновил расписание на следующую неделю, проверьте у себя.',
  'Кто-нибудь знает, почему у студентов не грузятся оценки?',
  'Похоже, это было на стороне кэша — после обновления всё ок.',
  'Отправил приглашения деканам, двое уже зарегистрировались.',
  'Нужна справка о месте учёбы для визы, подскажите сроки.',
  'Обычно три рабочих дня, но можно попросить ускорить.',
  'Скинь, пожалуйста, шаблон приказа о зачислении.',
  'Вечером пришлю, сейчас на паре.',
  'Как прошла защита диплома?',
  'Отлично, комиссия задала всего два вопроса 🎉',
  'Не забудьте заполнить анкету до пятницы.',
  'В кампусе сегодня отключат свет с 14 до 16 — учитывайте при планировании.',
  'Можно перенести консультацию на четверг?',
  'Да, в четверг после третьей пары свободно.',
  'Получил ваше письмо, отвечу до конца дня.',
  'Проверьте, пожалуйста, права доступа у модератора — он не видит жалобы.',
  'Исправил, теперь видит.',
  'Сколько сейчас активных пользователей на платформе?',
  'Около тринадцати тысяч, за неделю плюс четыре процента.',
  'Хотим подключить ещё два факультета в следующем семестре.',
  'Отлично, подготовлю инструкцию для администраторов.',
  'Пары в 301 аудитории переносятся в 204.',
  'Новый корпус открывают в понедельник.',
  'Кто едет на конференцию в Астану?',
  'Я еду, билеты уже купил ✈️',
  'Вышла новая версия приложения — проверьте обновление.',
  'На айфоне всё летает, спасибо!',
  'Нашёл баг: при смене языка сбрасывается фильтр.',
  'Записал, поправим в следующем релизе.',
  'Ребята, кто сделал лабораторную по базам данных?',
  'Я сделал, могу объяснить вторую часть.',
  'Сессия начинается 15 декабря, расписание экзаменов уже в приложении.',
  'Спасибо за помощь с документами 🙏',
  'Библиотека работает до 20:00 всю неделю.',
  'Мероприятие переносится на следующую среду.',
  'Кто-то оставил зарядку в 210 — заберите у охраны.',
  'Выложил записи лекций в материалы курса.',
]
const QUESTIONS = [
  'Когда будет готово?',
  'Ты где?',
  'Есть минутка?',
  'Можешь глянуть?',
  'Что думаешь?',
  'Успеваем к дедлайну?',
  'Кто отвечает за это?',
  'Это срочно?',
  'Получилось?',
  'Во сколько встречаемся?',
]
const LONG = [
  'Коротко по итогам недели:\n\n1. Подключили два новых вуза, оба прошли онбординг.\n2. Время разбора жалоб сократилось до 6 часов.\n3. Нашли и починили утечку уведомлений на Android.\n\nНа следующей неделе — запуск библиотеки в пилотном вузе и обновление каталога услуг. Если есть вопросы — пишите сюда.',
  'Напоминаю порядок подачи заявки на справку:\n— зайти в «Заявки»,\n— выбрать услугу «Справка с места учёбы»,\n— приложить удостоверение личности,\n— дождаться статуса «Готово».\n\nОригинал можно забрать в деканате с 9 до 17.',
  'Мне кажется, нам стоит пересмотреть формат еженедельных созвонов. Сейчас они идут по часу, и половину времени мы обсуждаем то, что можно было бы решить в чате. Предлагаю 20 минут по понедельникам и короткий письменный отчёт в пятницу.',
]
const FORMATTED = [
  '**Важно:** завтра техработы с 02:00 до 04:00, вход будет недоступен.',
  'Не забудьте **сдать отчёт** до *пятницы*.',
  'Команда для проверки: `pnpm db:status`',
  '**Дедлайн перенесли** на понедельник, *но* лучше сдать раньше.',
  'Итог: **12** новых заявок, *3* отклонены, `0` в ожидании.',
]
const EMOJI = ['😂', '🔥🔥🔥', '👍', '❤️', '🎉', '🙏', '😅', '🤝', '💯', '👀', '😎']
const LINKS = [
  {
    url: 'https://github.com/startupjafari/studenthub',
    title: 'StudentHub — платформа для университетов',
    description: 'Закрытая многоролевая образовательная платформа.',
    siteName: 'GitHub',
  },
  {
    url: 'https://habr.com/ru/articles/803115/',
    title: 'Как мы ускорили ленту в 10 раз',
    description: 'Разбор индексов и кэширования в Postgres.',
    siteName: 'Хабр',
  },
  {
    url: 'https://www.coursera.org/learn/machine-learning',
    title: 'Machine Learning Specialization',
    description: 'Курс Эндрю Ына по основам машинного обучения.',
    siteName: 'Coursera',
  },
  {
    url: 'https://egov.kz/cms/ru',
    title: 'Электронное правительство Республики Казахстан',
    description: 'Государственные услуги онлайн.',
    siteName: 'eGov.kz',
  },
  {
    url: 'https://developer.apple.com/design/human-interface-guidelines',
    title: 'Human Interface Guidelines',
    description: 'Руководство Apple по проектированию интерфейсов.',
    siteName: 'Apple Developer',
  },
  {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Лекция: введение в алгоритмы',
    description: 'Запись открытой лекции.',
    siteName: 'YouTube',
  },
]
const POLLS = [
  ['Когда проведём встречу?', ['Понедельник', 'Среда', 'Пятница']],
  ['Какой формат удобнее?', ['Онлайн', 'Офлайн', 'Гибрид']],
  ['Куда пойдём после сессии?', ['Кино', 'Боулинг', 'Кафе', 'Горы']],
  ['Оцените новую версию приложения', ['Отлично', 'Нормально', 'Есть проблемы']],
  ['Какие темы разобрать на консультации?', ['Базы данных', 'Алгоритмы', 'Сети', 'Безопасность']],
]
const GROUP_TITLES = [
  'Команда платформы',
  'Модераторы',
  'Запуск КазНУ',
  'Поддержка вузов',
  'Релизы iOS',
  'Онбординг деканов',
  'Карьерный центр',
  'Библиотека — пилот',
  'Охрана и камеры',
  'Аналитика',
  'Мобильная команда',
  'Юристы и ПДн',
  'Маркетинг',
  'Хакатон 2026',
  'Студсовет',
  'Конференция в Астане',
  'Расписание',
  'Приёмная комиссия',
  'Тестировщики',
  'Дизайн',
  'Партнёры',
  'Вузы Алматы',
  'Вузы Астаны',
  'Кураторы',
  'Бета-тест Android',
  'Ночные дежурства',
  'Отчёты недели',
  'Миграции БД',
  'Сессия — зима',
  'Общий',
  'Выпускники',
  'Стажировки',
  'Олимпиада',
  'Спорт',
  'Волонтёры',
  'Иностранные студенты',
  'Общежития',
]
const REACTIONS = ['👍', '❤️', '🔥', '😂', '🎉', '🙏', '👀', '💯']
const SYSTEM_TYPES = [
  'member_added',
  'member_removed',
  'member_left',
  'member_joined',
  'member_banned',
  'admin_granted',
  'admin_revoked',
  'title_changed',
  'avatar_changed',
  'owner_changed',
]
const SAVED_NOTES = [
  'Не забыть: продлить домен до 1 декабря',
  'Пароль от стенда — в менеджере, папка «StudentHub»',
  'Идеи: тёмная тема для лендинга, экспорт оценок в Excel',
  'Список вузов на подключение в декабре',
  'Купить подарки команде к Новому году 🎁',
]

// ── Медиа: генерация и загрузка ─────────────────────────────────────────────────

// Голосовое — WAV, 8 кГц, 16 бит: играется и в браузере, и в AVPlayer, кодировщик не
// нужен. «Слоги» — гармоники с огибающей и паузами: на волне видно речь, а не гудок.
function makeVoiceWav(seconds, seed) {
  const r = makeRandom(seed)
  const rate = 8000
  const samples = Math.floor(seconds * rate)
  const data = Buffer.alloc(samples * 2)
  let i = 0
  while (i < samples) {
    const syllable = Math.floor(rate * (0.12 + r.rng() * 0.18))
    const pause = r.chance(0.25)
      ? Math.floor(rate * (0.15 + r.rng() * 0.4))
      : Math.floor(rate * 0.03)
    const f0 = 110 + r.rng() * 120
    const loud = 0.25 + r.rng() * 0.45
    for (let k = 0; k < syllable && i < samples; k += 1, i += 1) {
      const t = i / rate
      const env = Math.sin((Math.PI * k) / syllable)
      const v =
        Math.sin(2 * Math.PI * f0 * t) * 0.6 +
        Math.sin(4 * Math.PI * f0 * t) * 0.25 +
        Math.sin(6 * Math.PI * f0 * t) * 0.1
      data.writeInt16LE(Math.round(v * env * loud * 32767 * 0.8), i * 2)
    }
    i += pause
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// Одностраничный PDF без зависимостей: шрифт Helvetica, поэтому текст латиницей.
function makePdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const body = [`BT /F1 20 Tf 60 780 Td (${esc(title)}) Tj ET`]
  lines.forEach((line, n) => body.push(`BT /F1 12 Tf 60 ${740 - n * 20} Td (${esc(line)}) Tj ET`))
  const stream = body.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, n) => {
    offsets.push(Buffer.byteLength(out))
    out += `${n + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

function makeXlsx() {
  try {
    const XLSX = requireFromApi('xlsx')
    const rows = [['Вуз', 'Студентов', 'Активны за неделю', 'Жалоб']]
    for (const [n, name] of ['КазНУ', 'КазНТУ', 'КБТУ', 'ЕНУ', 'АУЭС', 'МУИТ'].entries()) {
      rows.push([name, 4000 + n * 731, 1200 + n * 211, n * 3])
    }
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Отчёт')
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  } catch {
    return null
  }
}

async function download(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'studenthub-seed/1.0' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
}

/**
 * Набор объектов, на который ссылаются все вложения. Возвращает списки по видам или null,
 * если хранилище недоступно.
 */
async function prepareMedia() {
  let storage
  try {
    storage = createStorage()
    if (!(await storage.isAvailable())) throw new Error('MinIO не отвечает')
    await storage.ensureBuckets()
  } catch (error) {
    console.log(`  медиа пропущено: ${error.message}`)
    return null
  }
  const bucket = storage.buckets.chat
  const put = async (name, buffer, mime) => {
    const key = OBJECT_PREFIX + name
    await storage.client.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': mime })
    return { bucket, key, mime, size: buffer.length }
  }

  const media = { photos: [], videos: [], voices: [], audio: [], docs: [] }

  // Фото: picsum, размер в адресе — значит, ширина и высота известны без декодирования.
  const shapes = [
    [1280, 960],
    [1080, 1080],
    [960, 1280],
    [1280, 720],
  ]
  for (let n = 0; n < 32; n += 1) {
    const [w, h] = shapes[n % shapes.length]
    try {
      const buf = await download(`https://picsum.photos/seed/sh-chat-${n}/${w}/${h}.jpg`)
      media.photos.push({
        ...(await put(`photo-${n}.jpg`, buf, 'image/jpeg')),
        width: w,
        height: h,
        name: `IMG_${4100 + n}.jpg`,
      })
    } catch (error) {
      console.log(`  фото ${n}: ${error.message}`)
    }
  }

  // Видео: открытые образцы Blender Foundation (CC-BY), 10 секунд, ~1 МБ.
  const clips = [
    ['bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4', 640, 360],
    ['jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4', 1280, 720],
    ['sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4', 640, 360],
    ['bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', 1280, 720],
  ]
  for (const [n, [path, w, h]] of clips.entries()) {
    try {
      const buf = await download(`https://test-videos.co.uk/vids/${path}`)
      media.videos.push({
        ...(await put(`video-${n}.mp4`, buf, 'video/mp4')),
        width: w,
        height: h,
        durationMs: 10_000,
        name: `VID_${2200 + n}.mp4`,
      })
    } catch (error) {
      console.log(`  видео ${n}: ${error.message}`)
    }
  }

  for (let n = 0; n < 12; n += 1) {
    const seconds = [3, 5, 8, 12, 17, 24, 31, 45, 6, 9, 14, 58][n]
    const buf = makeVoiceWav(seconds, 900 + n)
    // Имя `voice-…` — главный признак голосового у клиентов (attachment-kind.ts).
    media.voices.push({
      ...(await put(`voice-${n}.wav`, buf, 'audio/wav')),
      durationMs: seconds * 1000,
      name: `voice-${n}.wav`,
    })
  }
  const lecture = makeVoiceWav(75, 777)
  media.audio.push({
    ...(await put('lecture.wav', lecture, 'audio/wav')),
    durationMs: 75_000,
    name: 'Запись лекции.wav',
  })

  const pdf = makePdf('StudentHub - weekly report', [
    'Universities connected: 9',
    'Active users (24h): 1 204',
    'Complaints resolved: 37',
    'Median resolution time: 6 h',
  ])
  media.docs.push({
    ...(await put('report.pdf', pdf, 'application/pdf')),
    name: 'Отчёт за неделю.pdf',
  })
  const contract = makePdf('Agreement No. 42', [
    'Parties: StudentHub and University',
    'Term: 12 months',
    'Signed electronically',
  ])
  media.docs.push({
    ...(await put('contract.pdf', contract, 'application/pdf')),
    name: 'Договор №42.pdf',
  })
  const csv = Buffer.from('﻿Вуз;Студентов;Жалоб\nКазНУ;4120;3\nКБТУ;3870;1\nЕНУ;5210;0\n', 'utf8')
  media.docs.push({ ...(await put('universities.csv', csv, 'text/csv')), name: 'Вузы.csv' })
  const txt = Buffer.from(
    'Протокол встречи\n\n1. Запуск библиотеки — декабрь.\n2. Камеры — пилот в двух вузах.\n3. Следующая встреча — через неделю.\n',
    'utf8',
  )
  media.docs.push({
    ...(await put('minutes.txt', txt, 'text/plain')),
    name: 'Протокол встречи.txt',
  })
  const xlsx = makeXlsx()
  if (xlsx) {
    media.docs.push({
      ...(await put(
        'stats.xlsx',
        xlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )),
      name: 'Статистика по вузам.xlsx',
    })
  }

  console.log(
    `  медиа в ${bucket}: фото ${media.photos.length}, видео ${media.videos.length}, ` +
      `голосовых ${media.voices.length}, документов ${media.docs.length}`,
  )
  return media
}

// ── Люди ────────────────────────────────────────────────────────────────────────

async function loadPeople(admin) {
  // Собеседники — живые аккаунты платформы: не удалённые, не заблокированные, с именем.
  const rows = await prisma.$queryRaw`
    SELECT id, first_name AS "firstName", last_name AS "lastName", username
    FROM users
    WHERE id <> ${admin.id} AND deleted_at IS NULL AND is_blocked = false
      AND first_name IS NOT NULL AND first_name <> ''
    ORDER BY md5(id || ${TAG})
    LIMIT 600`
  if (rows.length < 20) throw new Error(`Собеседников мало (${rows.length}) — база не засеяна?`)

  // Личный чат с человеком уже может быть: второй такой же сбил бы и клиент, и поиск
  // «написать» из профиля. Этих людей берём только в группы.
  const existing = await prisma.chatMember.findMany({
    where: {
      userId: { in: rows.map((r) => r.id) },
      chat: { type: 'PRIVATE', members: { some: { userId: admin.id } } },
    },
    select: { userId: true },
    take: 1000,
  })
  const taken = new Set(existing.map((m) => m.userId))
  return { all: rows, freeForPrivate: rows.filter((r) => !taken.has(r.id)) }
}

const fullName = (u) => `${u.lastName ?? ''} ${u.firstName ?? ''}`.trim()

// ── Генерация ───────────────────────────────────────────────────────────────────

const KINDS = [
  ['text', 34],
  ['short', 14],
  ['question', 5],
  ['long', 2],
  ['formatted', 3],
  ['emoji', 3],
  ['link', 3],
  ['mention', 2],
  ['photo', 6],
  ['album', 2],
  ['video', 2],
  ['spoiler', 1],
  ['rawPhoto', 1],
  ['voice', 5],
  ['audio', 1],
  ['document', 3],
  ['sharedPost', 1.5],
  ['sharedStory', 1],
  ['profile', 1],
  ['poll', 0.8],
  ['forward', 2.5],
  ['system', 1.2],
]

function timeline(count, endsAt) {
  // Идём от последнего сообщения назад: пачки реплик через секунды-минуты, между пачками —
  // часы и дни. Так в чате видны и разделители дат, и плотные диалоги.
  const times = []
  let t = endsAt.getTime()
  for (let n = 0; n < count; n += 1) {
    times.push(new Date(t))
    t -= chance(0.07) ? randInt(3, 60) * 3_600_000 : randInt(15, 600) * 1000
  }
  return times.reverse()
}

async function main() {
  if (MODE === 'cleanup') return cleanup()

  const admin =
    (await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { id: true, firstName: true, lastName: true },
    })) ??
    (await prisma.user.findFirst({
      where: { role: 'PLATFORM_ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }))
  if (!admin) throw new Error('Платформенный администратор не найден')
  const already = await prisma.chat.count({ where: { id: { startsWith: PREFIX } } })
  if (already > 0) {
    throw new Error(
      `С меткой «${TAG}» уже есть ${already} чатов. Новая метка — или сначала cleanup этой.`,
    )
  }
  console.log(
    `Чаты администратора ${fullName(admin)}: ${CHATS} шт., сообщений ${MSG_MIN}–${MSG_MAX}, метка ${TAG}`,
  )

  const people = await loadPeople(admin)
  const media = await prepareMedia()
  const posts = await prisma.post.findMany({
    where: { deletedAt: null, status: 'PUBLISHED' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  const stories = await prisma.story.findMany({
    select: { id: true, authorId: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })
  const hasSaved =
    (await prisma.chat.count({ where: { type: 'SAVED', createdById: admin.id } })) > 0

  // План чатов: «Сохранённые» (если их ещё нет), личные и группы.
  const plan = []
  if (!hasSaved) plan.push({ type: 'SAVED' })
  const privateCount = Math.min(people.freeForPrivate.length, Math.round(CHATS * 0.62))
  const privatePartners = sample(people.freeForPrivate, privateCount)
  for (const partner of privatePartners) plan.push({ type: 'PRIVATE', partner })
  while (plan.length < CHATS) plan.push({ type: 'GROUP' })
  random.shuffle(plan)

  const writer = createWriter(prisma, { chunkSize: 2000 })
  const counts = {}
  const bump = (kind) => (counts[kind] = (counts[kind] ?? 0) + 1)
  const forwardable = []
  let fileSeq = 0
  const now = Date.now()

  for (const [ci, entry] of plan.entries()) {
    const chatId = `${PREFIX}c${String(ci).padStart(3, '0')}`
    const isGroup = entry.type === 'GROUP'
    const isSaved = entry.type === 'SAVED'
    const members = isSaved
      ? [admin]
      : isGroup
        ? [admin, ...sample(people.all, randInt(3, 24))]
        : [admin, entry.partner]
    const total = isSaved ? randInt(Math.round(MSG_MIN / 2), MSG_MIN) : randInt(MSG_MIN, MSG_MAX)
    // Свежесть: первые чаты списка — сегодняшние, дальше — дни и недели назад.
    const endsAt = new Date(
      now -
        (ci < 25 ? randInt(2, 300) * 60_000 : randInt(1, 45) * 86_400_000) -
        randInt(0, 3_600_000),
    )
    const times = timeline(total, endsAt)

    // Чат — сразу с lastSeq: номер следующего сообщения из интерфейса = lastSeq + 1.
    const title = isGroup ? GROUP_TITLES[ci % GROUP_TITLES.length] : isSaved ? 'Сохранённые' : null
    await writer.add('chat', {
      id: chatId,
      type: entry.type,
      title,
      description: isGroup && chance(0.5) ? 'Рабочий чат. Важное — в закрепе.' : null,
      createdById: isGroup ? (chance(0.6) ? admin.id : members[1].id) : isSaved ? admin.id : null,
      lastSeq: total,
      createdAt: new Date(times[0].getTime() - 3_600_000),
    })
    const lastAt = times[times.length - 1]
    const unread = !isSaved && chance(0.35)
    for (const [mi, user] of members.entries()) {
      const isAdmin = user.id === admin.id
      await writer.add('chatMember', {
        id: `${chatId}-m${mi}`,
        chatId,
        userId: user.id,
        isAdmin: isGroup && (isAdmin || mi === 1),
        // У админа треть чатов с непрочитанным: в списке видны счётчики.
        lastReadAt: isAdmin
          ? unread
            ? times[Math.max(0, total - randInt(1, 40))]
            : lastAt
          : chance(0.8)
            ? lastAt
            : null,
        pinnedAt: isAdmin && ci < 4 ? new Date(now - ci * 60_000) : null,
        mutedAt: isAdmin && chance(0.08) ? new Date(now - 86_400_000) : null,
        muteImportantOnly: isAdmin && chance(0.04),
        archivedAt: isAdmin && ci >= 92 && !isSaved ? new Date(now - 3_600_000) : null,
        draft: isAdmin && (ci === 7 || ci === 19) ? 'Черновик ответа — допишу позже' : null,
        createdAt: new Date(times[0].getTime() - 3_600_000),
      })
    }
    await writer.flush()

    // Отправитель: в личном — серии реплик то одного, то другого, в группе — кто угодно,
    // админ примерно в каждом пятом.
    let speaker = members[members.length > 1 ? 1 : 0]
    const nextSender = () => {
      if (isSaved) return admin
      if (isGroup) return chance(0.2) ? admin : pick(members.slice(1))
      if (chance(0.45)) speaker = speaker.id === admin.id ? members[1] : admin
      return speaker
    }

    const messages = []
    const pollIds = new Set()
    const pinned = new Set(
      sample(
        [...Array(total).keys()].filter((n) => n > 5),
        randInt(1, 3),
      ),
    )
    for (let seq = 1; seq <= total; seq += 1) {
      const createdAt = times[seq - 1]
      const sender = nextSender()
      const id = `${chatId}-s${seq}`
      let kind = seq === 1 && !isSaved ? 'greeting' : pickWeighted(KINDS)
      if (isSaved && ['system', 'poll', 'mention', 'question'].includes(kind)) kind = 'text'
      if (!isGroup && kind === 'system') kind = 'text'
      if (
        !media &&
        ['photo', 'album', 'video', 'spoiler', 'rawPhoto', 'voice', 'audio', 'document'].includes(
          kind,
        )
      )
        kind = 'text'
      if (kind === 'sharedPost' && posts.length === 0) kind = 'text'
      if (kind === 'sharedStory' && stories.length === 0) kind = 'text'
      if (kind === 'forward' && forwardable.length === 0) kind = 'text'

      const row = { id, chatId, seq, senderId: sender.id, content: '', createdAt }
      const files = []
      const addFile = (item, extra = {}) => {
        fileSeq += 1
        files.push({
          id: `${PREFIX}f${fileSeq}`,
          bucket: item.bucket,
          key: item.key,
          mime: item.mime,
          size: item.size,
          name: item.name ?? null,
          ownerId: sender.id,
          messageId: id,
          width: item.width ?? null,
          height: item.height ?? null,
          durationMs: item.durationMs ?? null,
          createdAt,
          ...extra,
        })
      }

      switch (kind) {
        case 'greeting':
          row.content = pick(GREETINGS)
          break
        case 'short':
          row.content = pick(SHORT)
          break
        case 'question':
          row.content = pick(QUESTIONS)
          break
        case 'long':
          row.content = pick(LONG)
          break
        case 'formatted':
          row.content = pick(FORMATTED)
          break
        case 'emoji':
          row.content = pick(EMOJI)
          break
        case 'link': {
          const link = pick(LINKS)
          row.content = chance(0.5) ? `Посмотри: ${link.url}` : link.url
          row.linkPreview = {
            url: link.url,
            title: link.title,
            description: link.description,
            image: `https://picsum.photos/seed/${encodeURIComponent(link.siteName)}/600/315`,
            siteName: link.siteName,
          }
          break
        }
        case 'mention': {
          const other = pick(members.filter((m) => m.id !== sender.id)) ?? admin
          row.content = `${other.username ? `@${other.username}` : fullName(other)}, посмотри, пожалуйста, когда будет минутка`
          break
        }
        case 'photo':
          row.content = chance(0.4)
            ? pick([
                'Вот фото доски',
                'Смотрите, что получилось',
                'С мероприятия 📸',
                'Скрин ошибки',
              ])
            : ''
          addFile(pick(media.photos), { order: 0 })
          break
        case 'album': {
          row.content = chance(0.3) ? 'Фото с выезда' : ''
          for (const [order, photo] of sample(media.photos, randInt(2, 6)).entries())
            addFile(photo, { order })
          break
        }
        case 'video':
          if (media.videos.length === 0) {
            row.content = pick(LINES)
            break
          }
          row.content = chance(0.3) ? 'Короткое видео с пары' : ''
          addFile(pick(media.videos), { order: 0 })
          break
        case 'spoiler':
          row.content = 'Не открывайте, если не смотрели финал 🙈'
          addFile(pick(chance(0.7) || media.videos.length === 0 ? media.photos : media.videos), {
            order: 0,
            spoiler: true,
          })
          break
        case 'rawPhoto':
          row.content = 'Скан без сжатия'
          addFile({ ...pick(media.photos), name: `scan-${seq}.jpg` }, { asDocument: true })
          break
        case 'voice':
          addFile(pick(media.voices))
          break
        case 'audio':
          row.content = chance(0.5) ? 'Запись лекции' : ''
          addFile(media.audio[0])
          break
        case 'document':
          row.content = chance(0.5)
            ? pick(['Документ во вложении', 'Проверьте, пожалуйста', 'Финальная версия'])
            : ''
          addFile(pick(media.docs))
          break
        case 'sharedPost':
          row.content = chance(0.5) ? 'Интересный пост' : ''
          row.sharedPostId = pick(posts).id
          break
        case 'sharedStory': {
          const story = pick(stories)
          row.sharedStoryId = story.id
          // Ответ на историю — тот же sharedStoryId с отметкой sharedStoryReply.
          row.sharedStoryReply = chance(0.5)
          row.content = row.sharedStoryReply ? pick(['Классная история!', 'Где это?', '😍']) : ''
          break
        }
        case 'profile': {
          const user = pick(people.all)
          row.content = `${fullName(user)}\n${WEB_URL}/profile/${user.id}`
          break
        }
        case 'poll':
          row.content = pick(POLLS)[0]
          break
        case 'forward': {
          const origin = pick(forwardable)
          row.forwardedFromId = origin.id
          row.content = origin.content
          break
        }
        case 'system': {
          const type = pick(SYSTEM_TYPES)
          const target = pick(members.slice(1))
          row.systemType = type
          row.systemMeta =
            type === 'title_changed'
              ? { title }
              : type === 'avatar_changed'
                ? {}
                : { targetName: fullName(target) }
          break
        }
        default:
          row.content = pick(LINES)
      }
      if (isSaved && kind === 'text' && chance(0.4)) row.content = pick(SAVED_NOTES)

      // Модификаторы поверх вида — у обычных реплик.
      if (!row.systemType && seq > 3 && !row.forwardedFromId && chance(0.12)) {
        const target = messages[messages.length - randInt(1, Math.min(15, messages.length))]
        if (target && !target.systemType) {
          row.replyToId = target.id
          // Цитата — фрагмент исходного текста, как при выделении части сообщения.
          if (target.content.length > 30 && chance(0.4))
            row.replyQuote = target.content.slice(0, 30)
          bump('reply')
        }
      }
      if (!row.systemType && sender.id === admin.id && chance(0.06)) {
        row.editedAt = new Date(createdAt.getTime() + 120_000)
        bump('edited')
      }
      if (!row.systemType && chance(0.03)) {
        row.silent = true
        bump('silent')
      }
      if (!row.systemType && !files.length && seq < total - 2 && chance(0.012)) {
        row.deletedAt = new Date(createdAt.getTime() + 300_000)
        bump('deleted')
      }
      if (pinned.has(seq - 1) && !row.systemType && !row.deletedAt) {
        row.pinnedAt = new Date(createdAt.getTime() + 600_000)
        row.pinnedById = admin.id
        bump('pinned')
      }

      bump(kind)
      await writer.add('message', row)
      messages.push(row)
      for (const file of files) await writer.add('file', file)
      // Отметка опроса — отдельным списком: строка уже в буфере записи, и лишнее поле
      // в ней ушло бы в createMany.
      if (kind === 'poll') pollIds.add(id)
    }
    await writer.flush()

    // Реакции, опросы, отложенные — после сообщений (FK).
    for (const message of messages) {
      if (message.systemType || message.deletedAt || !chance(0.16)) continue
      const reactors = sample(members, randInt(1, Math.min(4, members.length)))
      for (const [ri, user] of reactors.entries()) {
        await writer.add('messageReaction', {
          id: `${message.id}-r${ri}`,
          messageId: message.id,
          userId: user.id,
          emoji: pick(REACTIONS),
          createdAt: new Date(message.createdAt.getTime() + randInt(10, 3600) * 1000),
        })
        bump('reaction')
      }
    }
    for (const message of messages.filter((m) => pollIds.has(m.id))) {
      const [question, options] = POLLS.find(([q]) => q === message.content) ?? pick(POLLS)
      const pollId = `${message.id}-poll`
      const multiple = chance(0.35)
      await writer.add('chatPoll', {
        id: pollId,
        messageId: message.id,
        question,
        multiple,
        anonymous: chance(0.4),
        closed: chance(0.2),
        createdAt: message.createdAt,
      })
      const optionIds = options.map((_, oi) => `${pollId}-o${oi}`)
      for (const [oi, text] of options.entries())
        await writer.add('chatPollOption', { id: optionIds[oi], pollId, text, order: oi })
      for (const user of sample(members, randInt(1, members.length))) {
        for (const optionId of multiple ? sample(optionIds, randInt(1, 2)) : [pick(optionIds)]) {
          await writer.add('chatPollVote', {
            id: `${optionId}-${user.id}`,
            pollId,
            optionId,
            userId: user.id,
            createdAt: message.createdAt,
          })
        }
      }
    }
    if (!isSaved && ci % 25 === 3) {
      for (let k = 0; k < 2; k += 1) {
        await writer.add('scheduledMessage', {
          id: `${chatId}-sched${k}`,
          chatId,
          senderId: admin.id,
          content: k === 0 ? 'Напоминание: отчёт за неделю до 18:00' : 'С наступающим! 🎄',
          scheduledAt: new Date(now + (k + 1) * 3 * 86_400_000),
          createdAt: new Date(now),
        })
        bump('scheduled')
      }
    }
    await writer.flush()

    for (const m of messages) {
      if (
        !m.systemType &&
        !m.deletedAt &&
        !m.forwardedFromId &&
        m.content &&
        !m.sharedPostId &&
        !m.sharedStoryId &&
        !pollIds.has(m.id) &&
        m.content.length > 15
      ) {
        if (forwardable.length < 400) forwardable.push({ id: m.id, content: m.content })
      }
    }
    process.stdout.write(
      `\r  чатов ${ci + 1}/${plan.length}, сообщений ${(counts.total = (counts.total ?? 0) + total)}   `,
    )
  }
  process.stdout.write('\n')

  console.log('Итог по видам:')
  for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
    console.log(`  ${kind}: ${n.toLocaleString('ru-RU')}`)
  console.log(`Готово: ${plan.length} чатов. Убрать: SEED_MODE=cleanup SEED_TAG=${TAG}`)
}

// ── Уборка ──────────────────────────────────────────────────────────────────────

async function cleanup() {
  // Файлы — первыми: связь с сообщением SetNull, и после сноса чатов строки остались бы
  // висеть без сообщения.
  const files = await prisma.file.deleteMany({ where: { id: { startsWith: PREFIX } } })
  // Участники, сообщения, реакции, опросы и отложенные уходят каскадом от чата.
  const chats = await prisma.chat.deleteMany({ where: { id: { startsWith: PREFIX } } })
  let objects = 0
  try {
    const storage = createStorage()
    if (await storage.isAvailable()) {
      const bucket = storage.buckets.chat
      const names = []
      await new Promise((resolve, reject) => {
        const stream = storage.client.listObjectsV2(bucket, OBJECT_PREFIX, true)
        stream.on('data', (obj) => names.push(obj.name))
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      if (names.length) await storage.client.removeObjects(bucket, names)
      objects = names.length
    }
  } catch (error) {
    console.log(`  объекты не удалены (их снимет ночная уборка cleanOrphanFiles): ${error.message}`)
  }
  console.log(`cleanup «${TAG}»: чатов ${chats.count}, файлов ${files.count}, объектов ${objects}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
