// Шаг «чаты»: групповые, предметные, факультетские и деканские чаты, личные диалоги,
// «Сохранённые», сообщения с ответами, пересылками, реакциями, закреплениями,
// опросами в чате и папками чатов.
//
// Про seq: Message уникален по (chatId, seq) — это порядковый номер сообщения в чате,
// по нему клиент строит порядок и докачивает историю. Поэтому нумерация идёт подряд с
// единицы, а Chat.lastSeq остаётся равным номеру последнего сообщения: рассинхрон
// сломал бы отправку следующего сообщения из интерфейса.

import { child, id } from '../lib/ids.mjs'
import { poolSlice } from './50-social.mjs'

const GROUP_TALK = [
  'Всем привет! Тут будем обсуждать учёбу и организационные вопросы.',
  'Напоминаю: лабораторные сдаём до пятницы.',
  'Кто записался на консультацию?',
  'Расписание на следующую неделю изменилось, смотрите в разделе «Изменения».',
  'Скинул конспект в файлы чата.',
  'Собрание группы завтра после третьей пары.',
  'Кто-нибудь понял последнее задание?',
  'Да, там нужно разобрать два случая.',
  'Спасибо!',
  'Не забудьте про пропуска в кампус — их выдают в 210.',
]
const SUBJECT_TALK = [
  'Материалы к семинару выложены.',
  'Вопрос по третьей задаче: можно использовать библиотеку?',
  'Можно, но решение нужно объяснить на защите.',
  'Дедлайн переносится на понедельник.',
  'Спасибо за уточнение!',
]
const DEAN_TALK = [
  'Деканат на связи: вопросы по документам и переводам пишите здесь.',
  'Приём по личным вопросам — вторник и четверг с 14:00.',
  'Справки готовятся до трёх рабочих дней.',
]
const PRIVATE_TALK = [
  'Привет! Ты идёшь на пары завтра?',
  'Да, к третьей. Возьми, пожалуйста, конспект.',
  'Хорошо, захвачу.',
  'Спасибо!',
  'Кинь потом фото доски, если успеешь.',
]
const CHAT_POLL = ['Когда проведём собрание группы?', ['Вторник', 'Среда', 'Четверг', 'Пятница']]
const REACTIONS = ['👍', '🔥', '❤️', '😂', '🙏']

export async function seedChats(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const slice = poolSlice(pool, index)
  // На вложения в чат остаются фото, не ушедшие в посты и альбомы (обычно ни одного);
  // если пул шире (SEED_PHOTOS), сюда попадёт хвост среза.
  const chatFiles = slice.photos.slice(8)

  // Чаты сначала планируются, и только потом пишутся — вместе с уже посчитанным
  // lastSeq. Иначе после каждой партии сообщений пришлось бы делать update чата
  // (≈300 чатов на вуз × 100 вузов = 30 000 лишних round-trip'ов).
  const chats = []
  const addChat = (chatId, row, memberIds, options = {}) => {
    const chat = { id: chatId, row: { ...row, universityId: uniId }, memberIds, options }
    chats.push(chat)
    return chat
  }

  // ── Чаты вуза ──────────────────────────────────────────────────────────────
  for (const faculty of people.faculties) {
    // Факультетский чат: декан + преподаватели + старосты.
    const facultyChatMembers = [
      faculty.deanId,
      ...faculty.teacherIds,
      ...faculty.groups.map((g) => g.starostaId),
    ]
    addChat(
      child(faculty.id, 'chat', 'fac'),
      { type: 'FACULTY', title: `${faculty.template.name} — общий`, facultyId: faculty.id },
      facultyChatMembers,
    )
    // Чат деканата: обращения студентов.
    addChat(
      child(faculty.id, 'chat', 'dean'),
      { type: 'DEAN', title: 'Деканат', facultyId: faculty.id },
      [faculty.deanId, ...faculty.groups.flatMap((g) => g.studentIds.slice(0, 3))],
    )

    for (const group of faculty.groups) {
      // Официальный чат группы (создаёт вуз) и обычный чат группы.
      addChat(
        child(group.id, 'chat', 'off'),
        { type: 'GROUP_OFFICIAL', title: `${group.name} — объявления`, groupId: group.id, facultyId: faculty.id }, // prettier-ignore
        [group.starostaId, ...group.studentIds.filter((s) => s !== group.starostaId)],
      )
      addChat(
        child(group.id, 'chat', 'grp'),
        { type: 'GROUP', title: group.name, groupId: group.id, facultyId: faculty.id },
        [group.starostaId, ...group.studentIds.filter((s) => s !== group.starostaId)],
      )
      // Предметный чат: одна дисциплина группы с её преподавателем.
      const subject = faculty.subjects[0]
      addChat(
        child(group.id, 'chat', 'subj'),
        { type: 'SUBJECT', title: `${group.name}: ${subject.name}`, groupId: group.id, facultyId: faculty.id, subject: subject.name }, // prettier-ignore
        [faculty.teacherIds[0], ...group.studentIds],
      )
      // Личные диалоги: три пары внутри группы.
      for (let k = 0; k < 3 && k + 1 < group.studentIds.length; k += 1) {
        addChat(
          child(group.id, 'chat', 'pv', k),
          { type: 'PRIVATE' },
          [group.studentIds[k], group.studentIds[k + 1]],
          { firstIsAdmin: false },
        )
      }
      // «Сохранённые» старосты: self-chat с единственным участником.
      addChat(
        child(group.starostaId, 'chat', 'saved'),
        { type: 'SAVED', title: 'Сохранённые', createdById: group.starostaId },
        [group.starostaId],
        { firstIsAdmin: false },
      )
    }
  }

  // Чат поддержки на вуз: администрация + модераторы.
  addChat(id(index, 'chat', 'support'), { type: 'SUPPORT', title: 'Поддержка' }, [
    people.adminId,
    ...people.moderatorIds,
  ])

  // ── План сообщений: сколько их в каждом чате (нужно для lastSeq) ───────────
  const pollChats = []
  const filesToAttach = []
  for (const chat of chats) {
    chat.texts = chat.id.includes('-chat-pv-')
      ? PRIVATE_TALK
      : chat.id.includes('-chat-dean')
        ? DEAN_TALK
        : chat.id.includes('-chat-subj')
          ? SUBJECT_TALK
          : GROUP_TALK
    if (chat.memberIds.length === 0) {
      chat.count = 0
      chat.lastSeq = 0
      continue
    }
    chat.count = Math.min(chat.texts.length, random.randInt(3, chat.texts.length))
    chat.hasPoll = chat.id.includes('-chat-off')
    // + системное сообщение, + сообщение-опрос в официальных чатах.
    chat.lastSeq = chat.count + 1 + (chat.hasPoll ? 1 : 0)
  }

  for (const chat of chats) {
    await writer.add('chat', { id: chat.id, ...chat.row, lastSeq: chat.lastSeq })
    for (const [mi, userId] of chat.memberIds.entries()) {
      await writer.add('chatMember', {
        id: child(chat.id, 'm', mi),
        chatId: chat.id,
        userId,
        isAdmin: mi === 0 && chat.options.firstIsAdmin !== false,
        lastReadAt: random.chance(0.7) ? random.randomDate(-3, 0) : null,
        // Часть участников приглушила чат, часть — только «важное» (§34).
        mutedAt: random.chance(0.15) ? random.randomDate(-30, -1) : null,
        muteImportantOnly: random.chance(0.1),
        pinnedAt: mi === 0 && random.chance(0.3) ? random.randomDate(-10, -1) : null,
        draft: random.chance(0.08) ? 'недописанное сообщение' : null,
        createdAt: random.randomDate(-300, -20),
      })
    }
  }
  // Чаты и участники должны быть в БД до сообщений и реакций (FK).
  await writer.flush()

  // ── Сообщения ──────────────────────────────────────────────────────────────
  for (const chat of chats) {
    if (chat.count === 0) continue
    const texts = chat.texts
    let seq = 0
    let firstMessageId = null
    for (let mi = 0; mi < chat.count; mi += 1) {
      seq += 1
      const messageId = child(chat.id, 'msg', seq)
      const senderId = chat.memberIds[mi % chat.memberIds.length]
      const isReply = mi > 1 && random.chance(0.3) && firstMessageId
      await writer.add('message', {
        id: messageId,
        chatId: chat.id,
        seq,
        senderId,
        content: texts[mi],
        replyToId: isReply ? firstMessageId : null,
        // Первое сообщение в официальном чате закреплено — как в реальном чате группы.
        ...(mi === 0 && chat.id.includes('-chat-off')
          ? { pinnedAt: random.randomDate(-20, -2), pinnedById: senderId }
          : {}),
        editedAt: random.chance(0.08) ? random.randomDate(-2, 0) : null,
        createdAt: random.randomDate(-30, 0),
      })
      if (mi === 0) firstMessageId = messageId
      if (mi === 1 && chatFiles.length > 0) {
        filesToAttach.push({ file: chatFiles[filesToAttach.length % chatFiles.length], messageId })
      }
    }

    // Системное сообщение о добавлении участника: в интерфейсе это отдельный вид.
    seq += 1
    await writer.add('message', {
      id: child(chat.id, 'msg', seq),
      chatId: chat.id,
      seq,
      senderId: chat.memberIds[0],
      content: '',
      // Тип и поля meta — те, что рендерит клиент (SYSTEM_KEY в message-item.tsx):
      // ключи в нижнем регистре, подпись строится из actor/targetName/title.
      systemType: 'member_added',
      systemMeta: { targetName: 'новый участник' },
      createdAt: random.randomDate(-25, -1),
    })

    // Опрос в чате — в официальных чатах групп.
    if (chat.hasPoll) {
      seq += 1
      const pollMessageId = child(chat.id, 'msg', seq)
      await writer.add('message', {
        id: pollMessageId,
        chatId: chat.id,
        seq,
        senderId: chat.memberIds[0],
        content: CHAT_POLL[0],
        createdAt: random.randomDate(-15, -1),
      })
      pollChats.push({ chat, messageId: pollMessageId })
    }

    // Номер последнего сообщения обязан совпасть с посчитанным заранее lastSeq,
    // иначе отправка следующего сообщения из интерфейса упадёт на (chatId, seq).
    if (seq !== chat.lastSeq) {
      throw new Error(`Чат ${chat.id}: lastSeq ${chat.lastSeq} != фактических ${seq}`)
    }
    chat.firstMessageId = firstMessageId
  }
  await writer.flush()

  // ── Реакции на сообщения, вложения, опросы ─────────────────────────────────
  for (const chat of chats) {
    if (!chat.firstMessageId) continue
    for (const [ri, userId] of random.sample(chat.memberIds, random.randInt(0, 4)).entries()) {
      await writer.add('messageReaction', {
        id: child(chat.firstMessageId, 'rx', ri),
        messageId: chat.firstMessageId,
        userId,
        emoji: random.pick(REACTIONS),
        createdAt: random.randomDate(-20, 0),
      })
    }
  }

  for (const { file, messageId } of filesToAttach) {
    await prisma.file.update({ where: { id: file.fileId }, data: { messageId } }).catch(() => {})
  }

  for (const { chat, messageId } of pollChats) {
    const pollId = child(messageId, 'poll')
    await writer.add('chatPoll', {
      id: pollId,
      messageId,
      question: CHAT_POLL[0],
      multiple: false,
      anonymous: random.chance(0.4),
      closed: random.chance(0.2),
      createdAt: random.randomDate(-15, -1),
    })
    const optionIds = []
    for (const [oi, text] of CHAT_POLL[1].entries()) {
      const optionId = child(pollId, 'o', oi)
      optionIds.push(optionId)
      await writer.add('chatPollOption', { id: optionId, pollId, text, order: oi })
    }
    // Голос уникален по (option, user): по одному голосу на участника.
    for (const userId of random.sample(chat.memberIds, random.randInt(2, 8))) {
      const optionId = random.pick(optionIds)
      await writer.add('chatPollVote', {
        id: `${optionId}-v-${userId}`,
        pollId,
        optionId,
        userId,
        createdAt: random.randomDate(-14, 0),
      })
    }
  }
  await writer.flush()

  // ── Папки чатов (у старост: «Учёба» и «Группа») ────────────────────────────
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const ownerId = group.starostaId
      if (!ownerId) continue
      for (const [fi, name] of ['Учёба', 'Группа'].entries()) {
        const folderId = child(ownerId, 'fold', fi)
        await writer.add('chatFolder', { id: folderId, userId: ownerId, name, position: fi })
        const chatId = fi === 0 ? child(group.id, 'chat', 'subj') : child(group.id, 'chat', 'grp')
        await writer.add('chatFolderItem', { id: child(folderId, 'i'), folderId, chatId })
      }
    }
  }

  await writer.flush()
  return { chats: chats.length }
}
