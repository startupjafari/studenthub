// Шаг «чаты: остальное»: то, что шаг 60 не создаёт, — чек-листы, геопозиции, карточки
// контактов, отложенные сообщения и «удалить у себя».
//
// Чек-лист, геопозиция и контакт — это не отдельные сущности, а обычные Message с пустым
// `content` и связанной записью 1:1 (как сообщение-опрос). Сервис пишет их так же, как
// любое сообщение: номер берёт из Chat.lastSeq (allocateSeq) и поднимает его. Поэтому
// здесь главное — seq: он уникален в чате, и Chat.lastSeq обязан остаться равным номеру
// последнего сообщения, иначе следующая отправка из интерфейса упадёт на (chatId, seq).
//
// Номер нельзя вывести заранее: сколько сообщений в чате, решил случайный выбор шага 60.
// Поэтому lastSeq читается из базы, а повторный прогон узнаёт свои сообщения по
// детерминированному id и берёт их прежний номер — иначе каждый перезапуск добавлял бы
// в чат ещё по чек-листу с новым seq.
//
// Сообщения шага 60 тоже известны по id: `<чат>-msg-<seq>`, и seq 1..3 в групповом чате
// есть всегда (там не меньше трёх реплик), — на них и ставятся отметки «скрыто у меня».
//
// Остальное покрытие сценариев (вложения всех форматов, стикеры и избранные стикеры,
// пересылки, системные события, обращения в поддержку платформы, настройки участников) —
// шаг 64, его этот шаг зовёт последним: lastSeq он читает из базы так же, как этот.

import { phone } from '../data/people.mjs'
import { child, uniPrefix } from '../lib/ids.mjs'
import { seedChatCoverage } from './64-chat-coverage.mjs'

// Координаты городов (WGS84) — центр города. Точка встречи студентов ставится рядом с ним
// со случайным смещением в пределах пары километров. Незнакомый город — Алматы: точка
// на карте всё равно будет правдоподобной, а не в океане.
const CITY_COORDS = {
  Алматы: [43.2389, 76.8897],
  Астана: [51.1694, 71.4491],
  Шымкент: [42.3417, 69.5901],
  Караганда: [49.8047, 73.1094],
  Костанай: [53.2144, 63.6246],
  Актобе: [50.2839, 57.167],
  'Усть-Каменогорск': [49.9481, 82.6286],
  Семей: [50.4111, 80.2275],
  Уральск: [51.2333, 51.3667],
  Тараз: [42.9, 71.3667],
  Кокшетау: [53.2833, 69.3833],
  Павлодар: [52.2833, 76.9667],
  Петропавловск: [54.8667, 69.15],
  Кызылорда: [44.8528, 65.5092],
  Атырау: [47.1167, 51.8833],
  Экибастуз: [51.7236, 75.3228],
  Туркестан: [43.3017, 68.2703],
  Темиртау: [50.0549, 72.9646],
  Талдыкорган: [45.0156, 78.3739],
  Рудный: [52.9667, 63.1167],
  Косшы: [51.0128, 71.3756],
  Каскелен: [43.2, 76.6167],
  Жезказган: [47.7833, 67.7667],
  Байконыр: [45.6167, 63.3167],
  Аркалык: [50.2486, 66.9114],
  Актау: [43.65, 51.15],
}

const PLACES = [
  ['Главный корпус', 'вход со стороны парковки'],
  ['Библиотека', 'читальный зал, 2 этаж'],
  ['Столовая', 'у окна раздачи'],
  ['Спортзал', 'раздевалки, цокольный этаж'],
  ['Кофейня у кампуса', 'через дорогу от главного входа'],
]

const CHECKLISTS = [
  [
    'Подготовка к сессии',
    [
      'Сдать лабораторные',
      'Закрыть пропуски',
      'Получить допуск',
      'Сдать курсовую',
      'Записаться на консультацию',
    ],
  ],
  ['Собрание группы', ['Выбрать дату', 'Забронировать аудиторию', 'Разослать повестку', 'Подготовить список вопросов']], // prettier-ignore
  ['Документы в деканат', ['Справка с места учёбы', 'Заявление на стипендию', 'Копия удостоверения', 'Фото 3×4']], // prettier-ignore
]

const SCHEDULED_TEXTS = {
  teacher: [
    'Напоминаю: завтра контрольная по пройденной теме, возьмите калькуляторы.',
    'Через неделю — защита лабораторных. Подготовьте отчёты.',
    'Консультация перед экзаменом переносится, точное время сообщу отдельно.',
  ],
  starosta: [
    'Не забудьте: собрание группы после третьей пары.',
    'Напоминаю про сбор подписей для деканата до пятницы.',
    'Завтра последний день сдачи заявлений на общежитие.',
  ],
}

export async function seedChatExtras(prisma, writer, ctx) {
  const { index, random, structure, people } = ctx
  const { profile } = structure
  const [baseLat, baseLng] = CITY_COORDS[profile.cityName] ?? CITY_COORDS['Алматы']

  // ── План: какие сообщения в какие чаты ─────────────────────────────────────
  // Только чаты, которые шаг 60 создаёт гарантированно: групповой у каждой группы и первый
  // личный диалог там, где в группе хотя бы двое.
  const plans = []
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const members = [group.starostaId, ...group.studentIds.filter((s) => s !== group.starostaId)] // prettier-ignore
      const groupChatId = child(group.id, 'chat', 'grp')
      plans.push({ kind: 'checklist', chatId: groupChatId, senderId: group.starostaId, members })
      if (members.length > 1 && random.chance(0.6)) {
        plans.push({ kind: 'geo', chatId: groupChatId, senderId: random.pick(members), members })
      }
      if (group.studentIds.length >= 2) {
        plans.push({
          kind: 'contact',
          chatId: child(group.id, 'chat', 'pv', 0),
          senderId: group.studentIds[0],
          members: [group.studentIds[0], group.studentIds[1]],
          faculty,
        })
      }
    }
  }
  for (const plan of plans) plan.messageId = child(plan.chatId, 'msg', plan.kind)

  // ── Номера сообщений ───────────────────────────────────────────────────────
  const chatIds = [...new Set(plans.map((p) => p.chatId))]
  const chatRows = await prisma.chat.findMany({
    where: { id: { in: chatIds } },
    select: { id: true, lastSeq: true },
    take: chatIds.length,
  })
  const lastSeq = new Map(chatRows.map((c) => [c.id, c.lastSeq]))
  const messageIds = plans.map((p) => p.messageId)
  const existing = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    select: { id: true, seq: true },
    take: messageIds.length,
  })
  const existingSeq = new Map(existing.map((m) => [m.id, m.seq]))

  const nextSeq = new Map(lastSeq)
  const newLastSeq = new Map(lastSeq)
  for (const plan of plans) {
    // Чата нет (шаг 60 его не создал) — сообщение некуда положить.
    if (!lastSeq.has(plan.chatId)) continue
    if (existingSeq.has(plan.messageId)) {
      plan.seq = existingSeq.get(plan.messageId)
    } else {
      plan.seq = nextSeq.get(plan.chatId) + 1
      nextSeq.set(plan.chatId, plan.seq)
    }
    newLastSeq.set(plan.chatId, Math.max(newLastSeq.get(plan.chatId), plan.seq))
  }

  // ── Сообщения и их содержимое ─────────────────────────────────────────────
  const placed = plans.filter((p) => p.seq != null)
  for (const plan of placed) {
    plan.createdAt = random.randomDate(-6, 0)
    await writer.add('message', {
      id: plan.messageId,
      chatId: plan.chatId,
      seq: plan.seq,
      senderId: plan.senderId,
      // У чек-листа, геопозиции и контакта текста нет: содержимое — в связанной записи.
      content: '',
      createdAt: plan.createdAt,
    })
  }
  await writer.flush()

  // Chat.lastSeq — после сообщений: прерванный прогон, записавший сообщения, но не номер,
  // повторный запуск всё равно сведёт (номера своих сообщений он прочитает по их id).
  // Prisma заодно сдвинет updatedAt — как bumpChat у сервиса при каждом новом сообщении.
  const bumps = [...newLastSeq].filter(([chatId, seq]) => seq !== lastSeq.get(chatId))
  if (bumps.length > 0) {
    await prisma.$transaction(
      bumps.map(([chatId, seq]) =>
        prisma.chat.update({ where: { id: chatId }, data: { lastSeq: seq } }),
      ),
    )
  }

  for (const plan of placed) {
    if (plan.kind === 'checklist') {
      const [title, texts] = random.pick(CHECKLISTS)
      const checklistId = child(plan.messageId, 'cl')
      const othersCanAdd = random.chance(0.7)
      const othersCanMark = random.chance(0.8)
      const items = texts.map((text, order) => {
        // Отмечать может автор, а остальные — только если автор это разрешил. Время
        // отметки не уходит в будущее: чек-лист мог быть создан пару часов назад.
        const doneById = random.chance(0.45)
          ? othersCanMark
            ? random.pick(plan.members)
            : plan.senderId
          : null
        const doneAt = doneById
          ? new Date(Math.min(Date.now(), plan.createdAt.getTime() + random.randInt(1, 72) * 3_600_000)) // prettier-ignore
          : null
        return { id: child(checklistId, 'i', order), checklistId, text, order, doneById, doneAt, createdById: plan.senderId, createdAt: plan.createdAt } // prettier-ignore
      })
      // updatedAt — время последней правки пунктов: по нему догон после обрыва отдаёт
      // сообщение чек-листа в `mutated`.
      const touched = items.reduce((max, item) => Math.max(max, item.doneAt?.getTime() ?? 0), plan.createdAt.getTime()) // prettier-ignore
      await writer.add('chatChecklist', {
        id: checklistId,
        messageId: plan.messageId,
        title,
        othersCanAdd,
        othersCanMark,
        createdAt: plan.createdAt,
        updatedAt: new Date(touched),
      })
      for (const item of items) await writer.add('chatChecklistItem', item)
    } else if (plan.kind === 'geo') {
      const [title, address] = random.pick(PLACES)
      // Часть — завершённые трансляции: точка двигалась, потом время вышло. Идущих сейчас
      // трансляций нет — их некому двигать, и клиент ждал бы обновлений, которых не будет.
      const live = random.chance(0.2)
      const liveUntil = live ? new Date(plan.createdAt.getTime() + 15 * 60_000) : null
      await writer.add('chatLocation', {
        messageId: plan.messageId,
        lat: Number((baseLat + (random.rng() - 0.5) * 0.03).toFixed(6)),
        lng: Number((baseLng + (random.rng() - 0.5) * 0.03).toFixed(6)),
        title,
        address: `${profile.cityName}, ${address}`,
        liveUntil,
        liveUpdatedAt: liveUntil,
        heading: live ? random.randInt(0, 359) : null,
        accuracy: random.randInt(5, 40),
      })
    } else if (plan.kind === 'contact') {
      // Карточка рабочего контакта деканата. userId сервер не заполняет (поиск по телефону
      // раскрывал бы, кто зарегистрирован), поэтому и здесь его нет.
      await writer.add('chatContact', {
        messageId: plan.messageId,
        name: `Деканат — ${plan.faculty.template.name}`.slice(0, 120),
        phones: [phone(random)],
        emails: [`dekanat.${plan.faculty.template.code}@${uniPrefix(index)}.edu.kz`],
        userId: null,
      })
    }
  }

  // ── Отложенные сообщения ──────────────────────────────────────────────────
  // Только в будущем: прошедший срок забрал бы cron доставки, и сообщение ушло бы в чат
  // сразу после сида. Сервис хранит у отложенного только текст, без вложений.
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const targets = [
        ['teacher', child(group.id, 'chat', 'subj'), faculty.teacherIds[0]],
        ['starosta', child(group.id, 'chat', 'off'), group.starostaId],
      ]
      for (const [role, chatId, senderId] of targets) {
        if (!senderId || !random.chance(0.5)) continue
        await writer.add('scheduledMessage', {
          id: child(chatId, 'sched', 0),
          chatId,
          senderId,
          content: random.pick(SCHEDULED_TEXTS[role]),
          silent: random.chance(0.2),
          scheduledAt: new Date(Date.now() + random.randInt(6, 14 * 24) * 3_600_000),
          createdAt: random.randomDate(-2, 0),
        })
      }

      // «Удалить у себя»: пара участников группового чата скрыла одно из первых сообщений.
      const groupChatId = child(group.id, 'chat', 'grp')
      if (!lastSeq.has(groupChatId)) continue
      for (const userId of random.sample(group.studentIds, random.randInt(0, 2))) {
        await writer.add('hiddenMessage', {
          userId,
          messageId: child(groupChatId, 'msg', random.randInt(1, 3)),
          createdAt: random.randomDate(-5, 0),
        })
      }
    }
  }

  await writer.flush()

  // Полное покрытие сценариев — после всего выше: оно дописывает сообщения за lastSeq,
  // который этот шаг только что поднял. Центр города — для трансляции геопозиции.
  const coverage = await seedChatCoverage(prisma, writer, { ...ctx, cityCoords: [baseLat, baseLng] }) // prettier-ignore
  return { messages: placed.length + coverage.messages }
}
