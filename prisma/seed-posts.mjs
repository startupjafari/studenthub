// Демо-посты для ленты: 10 текстовых от разных авторов и 10 объявлений от админа вуза.
// Вложений нет намеренно — файлы в MinIO сидером не создать, а без них видно, как лента
// ведёт себя с постами разной длины: от одной строки до размеченного объявления.
//
// Запуск: node prisma/seed-posts.mjs  (или pnpm db:seed:posts)
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Детерминированный генератор: повторный прогон даёт те же тексты и те же даты.
function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
const rng = makeRng(20260828)
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))
const HOUR = 3600_000

// 10 обычных постов: короткие заметки без разметки и заголовка — так в ленте
// проверяется случай «текст в одну строку, кнопки „Читать далее“ быть не должно».
const PLAIN = [
  'Кто-нибудь брал конспект по матанализу за прошлый семестр?',
  'Напоминаю: завтра сдаём отчёты по практике до 17:00.',
  'В библиотеке появились новые методички по схемотехнике.',
  'Ищу напарника для командного проекта по веб-разработке.',
  'Столовая на первом этаже сегодня закрыта, работает только буфет.',
  'Кто идёт на консультацию по базам данных в четверг?',
  'Потерял пропуск в корпусе Б, если нашли — напишите в личку.',
  'Записался на курс по машинному обучению, свободных мест ещё много.',
  'Спортзал открыт до 21:00 всю неделю, расписание секций на стенде.',
  'Не забудьте продлить читательский билет до конца месяца.',
]

// 10 объявлений админа вуза: с заголовком и разметкой — то, ради чего заголовок
// и markdown вообще заводились.
const ANNOUNCEMENTS = [
  {
    title: 'График работы деканатов в праздничные дни',
    content:
      'С **1 по 5 января** деканаты работают по сокращённому графику. Приём заявок в электронном виде идёт *без изменений*.\n\n> Заявки, поданные после 30 декабря, будут обработаны 6 января.',
  },
  {
    title: 'Открыта запись на зимнюю сессию',
    content:
      'Записаться можно до **20 декабря** через раздел «Экзамены».\n\n- Пересдачи — с 10 января\n- Допуск проверяйте в журнале\n- Вопросы — в деканат своего факультета',
  },
  {
    title: 'Новая IT-лаборатория в корпусе В',
    content:
      'Открыта лаборатория на **30 рабочих мест**: сдвоенные мониторы, доступ к учебным серверам.\n\nЗапись на свободные часы — через раздел «Помещения».',
  },
  {
    title: 'Стипендиальная комиссия начинает работу',
    content:
      'Заседания проходят с **15 по 25 число** каждого месяца.\n\n1. Подайте заявку через раздел «Заявки»\n2. Приложите справку о доходах\n3. Дождитесь решения в личном кабинете',
  },
  {
    title: 'Обновлены правила пользования библиотекой',
    content:
      'Срок выдачи учебников продлён до **30 дней**. Электронные ресурсы доступны из дома по студенческому логину.\n\n~~Штраф за просрочку 200 тенге в день~~ отменён.',
  },
  {
    title: 'Медосмотр для первого курса',
    content:
      'Проходит с **10 по 20 сентября** в медпункте корпуса А.\n\nПри себе иметь: паспорт, студенческий, флюорографию за текущий год.',
  },
  {
    title: 'Конкурс студенческих проектов',
    content:
      'Принимаем заявки до **1 марта**. Победители получают грант на реализацию.\n\n- Направления: IT, экология, социальные проекты\n- Команда до 5 человек\n- Подробности — в [положении о конкурсе](https://studenthub.kz/contest)',
  },
  {
    title: 'Изменения в расписании звонков',
    content:
      'С понедельника первая пара начинается в **08:30** вместо 08:00.\n\nПерерыв между второй и третьей парой увеличен до 20 минут.',
  },
  {
    title: 'Военная кафедра: набор на новый учебный год',
    content:
      'Документы принимаются до **15 сентября**.\n\n1. Заявление\n2. Медицинская справка формы `086/у`\n3. Копия приписного свидетельства',
  },
  {
    title: 'Общежитие: заселение и оплата',
    content:
      'Заселение с **25 августа**, оплата за первый семестр — до 10 сентября.\n\n> Места распределяются по льготным категориям и удалённости от города.',
  },
]

async function main() {
  const uni = await prisma.university.findFirst({ select: { id: true } })
  if (!uni) throw new Error('Нет вуза — сначала прогоните основной сид (pnpm db:seed)')

  const admin = await prisma.user.findFirst({
    where: { role: 'UNIVERSITY_ADMIN', universityId: uni.id, deletedAt: null },
    select: { id: true },
  })
  if (!admin) throw new Error('Нет администратора вуза — сначала прогоните основной сид')

  // Обычные посты пишут студенты и старосты: у них аудитория — своя группа.
  const students = await prisma.user.findMany({
    where: {
      role: { in: ['STUDENT', 'STAROSTA'] },
      universityId: uni.id,
      groupId: { not: null },
      deletedAt: null,
    },
    select: { id: true, groupId: true },
    take: 50,
  })
  if (students.length === 0) throw new Error('Нет студентов с группой — прогоните основной сид')

  const rows = []

  PLAIN.forEach((content, i) => {
    const author = students[randInt(0, students.length - 1)]
    rows.push({
      id: `seed-post-plain-${String(i + 1).padStart(2, '0')}`,
      authorId: author.id,
      audience: 'GROUP',
      groupId: author.groupId,
      universityId: uni.id,
      title: null,
      content,
      status: 'PUBLISHED',
      // Разносим по времени, чтобы лента не выглядела «всё опубликовано разом».
      publishedAt: new Date(Date.now() - (i * 7 + randInt(1, 6)) * HOUR),
      createdAt: new Date(Date.now() - (i * 7 + randInt(1, 6)) * HOUR),
      views: randInt(3, 90),
    })
  })

  ANNOUNCEMENTS.forEach((a, i) => {
    rows.push({
      id: `seed-post-admin-${String(i + 1).padStart(2, '0')}`,
      authorId: admin.id,
      audience: 'UNIVERSITY',
      universityId: uni.id,
      title: a.title,
      content: a.content,
      status: 'PUBLISHED',
      // Приоритет объявлений вуза — как у настоящих постов админа (см. priorityFor).
      priority: 2,
      publishedAt: new Date(Date.now() - (i * 11 + randInt(1, 9)) * HOUR),
      createdAt: new Date(Date.now() - (i * 11 + randInt(1, 9)) * HOUR),
      views: randInt(20, 400),
    })
  })

  for (const { id, ...data } of rows) {
    await prisma.post.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  const plain = await prisma.post.count({ where: { id: { startsWith: 'seed-post-plain-' } } })
  const adminPosts = await prisma.post.count({ where: { id: { startsWith: 'seed-post-admin-' } } })
  console.log(`Посты: без изображений ${plain}, от админа вуза ${adminPosts}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
