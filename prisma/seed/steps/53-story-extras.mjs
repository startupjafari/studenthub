// Шаг «сторис: чаты и жалобы» (вызывается из 52): то, что требует уже записанных сторис.
//
// СТОРИС В ЛИЧНОМ ЧАТЕ. Ответ на сторис (sharedStoryReply = true) — сообщение автору с
// карточкой сторис, пересылка (false) — сторис другого автора в личный диалог. Оба — обычные
// Message: сервис берёт номер из Chat.lastSeq (allocateSeq) и поднимает его. Поэтому здесь
// то же правило, что в шаге 62: seq уникален в чате, Chat.lastSeq обязан остаться номером
// последнего сообщения. Номер читается из базы (сколько сообщений в чате, решили шаги 60 и
// 62), а повторный прогон узнаёт свои сообщения по детерминированному id и берёт их номер.
//
// Чат — первый личный диалог группы (шаг 60: studentIds[0] и studentIds[1]). Первый в группе —
// староста, его первая сторис адресована группе (шаг 52 это гарантирует), второй её видит и
// отвечает. Пересылает староста сторис админа на весь вуз: её видят оба, а сервис пересылает
// только то, что видно получателю (shareStory → isVisibleToUser).
//
// ЖАЛОБЫ. На сторис (STORY, приоритет MEDIUM) и на комментарий к посту (COMMENT, LOW) —
// complaintPriorityFor в shared-schemas. Остальные цели (POST, MESSAGE, USER) пишет шаг 70.

import { child, id } from '../lib/ids.mjs'

const STORY_REPLIES = ['Классно! 🔥', 'Где это?', 'Я тоже там был(а)!', 'Скинь подробности в личку', 'Ахах, жиза 😂'] // prettier-ignore
const STORY_SHARE_COMMENTS = ['', 'Видел(а)?', 'Смотри, это про нас']
const STORY_COMPLAINT_REASONS = [
  'Оскорбительный текст в сторис',
  'Реклама сторонних услуг',
  'Чужие фото без согласия',
  'Нарушение правил сообщества',
]
const COMMENT_COMPLAINT_REASONS = ['Спам в комментариях', 'Грубость в обсуждении']
const STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED']

// Момент между `from` и «сейчас»: сообщение и жалоба не бывают раньше сторис.
const between = (random, from) =>
  new Date(from.getTime() + Math.floor(random.rng() * Math.max(0, Date.now() - from.getTime())))

export async function seedStoryMessages(prisma, writer, ctx, { liveStories }) {
  const { random, people } = ctx
  const adminStory = (liveStories.get(people.adminId) ?? []).find((s) => s.audience === 'UNIVERSITY') // prettier-ignore

  // ── План: какие сообщения в какие чаты ─────────────────────────────────────
  const plans = []
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const [first, second] = group.studentIds
      if (!first || !second) continue
      const chatId = child(group.id, 'chat', 'pv', 0)
      const story = (liveStories.get(first) ?? []).find(
        (s) => s.audience === 'GROUP' && s.groupId === group.id,
      )
      if (story) {
        plans.push({
          chatId,
          messageId: child(chatId, 'msg', 'story-reply'),
          senderId: second,
          storyId: story.id,
          reply: true,
          content: STORY_REPLIES[plans.length % STORY_REPLIES.length],
          after: story.createdAt,
        })
      }
      if (adminStory) {
        plans.push({
          chatId,
          messageId: child(chatId, 'msg', 'story-share'),
          senderId: first,
          storyId: adminStory.id,
          reply: false,
          content: STORY_SHARE_COMMENTS[plans.length % STORY_SHARE_COMMENTS.length],
          after: adminStory.createdAt,
        })
      }
    }
  }
  if (plans.length === 0) return { storyMessages: 0 }

  // ── Номера сообщений: как в шаге 62 ────────────────────────────────────────
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

  // Время — после публикации сторис и по порядку номеров внутри чата: пересылка (больший
  // seq) не раньше ответа.
  const placed = plans.filter((p) => p.seq != null)
  const lastAt = new Map()
  for (const plan of placed) {
    const floor = new Date(Math.max(plan.after.getTime(), lastAt.get(plan.chatId)?.getTime() ?? 0)) // prettier-ignore
    const createdAt = between(random, floor)
    lastAt.set(plan.chatId, createdAt)
    await writer.add('message', {
      id: plan.messageId,
      chatId: plan.chatId,
      seq: plan.seq,
      senderId: plan.senderId,
      content: plan.content,
      sharedStoryId: plan.storyId,
      sharedStoryReply: plan.reply,
      createdAt,
    })
  }
  await writer.flush()

  // Chat.lastSeq — после сообщений: прерванный прогон, записавший сообщения, но не номер,
  // повторный запуск всё равно сведёт. Prisma заодно сдвинет updatedAt — как bumpChat.
  const bumps = [...newLastSeq].filter(([chatId, seq]) => seq !== lastSeq.get(chatId))
  if (bumps.length > 0) {
    await prisma.$transaction(
      bumps.map(([chatId, seq]) =>
        prisma.chat.update({ where: { id: chatId }, data: { lastSeq: seq } }),
      ),
    )
  }
  return { storyMessages: placed.length }
}

export async function seedStoryComplaints(prisma, writer, ctx, { liveStories }) {
  const { index, random, structure, people } = ctx
  const { uniId } = structure
  const moderators = people.moderatorIds.length > 0 ? people.moderatorIds : [people.adminId]
  let complaints = 0
  // Решённые жалобы на сторис: по ним — предупреждение автору (ResolveComplaint WARN_USER).
  const warnings = []

  // Статусы по кругу: очередь, «на рассмотрении» (reviewingBy), решённая с предупреждением
  // автору и отклонённая — каждый вид в каждом вузе.
  const closing = (status, k, createdAt) => {
    const moderatorId = moderators[k % moderators.length]
    const closed = status === 'RESOLVED' || status === 'DISMISSED'
    return {
      status,
      reviewingById: status === 'REVIEWING' ? moderatorId : null,
      resolvedById: closed ? moderatorId : null,
      resolution: closed
        ? status === 'RESOLVED'
          ? 'Автору выдано предупреждение'
          : 'Нарушения не найдено'
        : null,
      resolvedAt: closed ? between(random, createdAt) : null,
    }
  }

  // ── Жалобы на сторис: однокурсник жалуется на сторис группе ─────────────────
  const targets = []
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      for (const authorId of group.studentIds) {
        const story = (liveStories.get(authorId) ?? []).find((s) => s.audience === 'GROUP')
        if (story) targets.push({ story, group })
        if (targets.length >= STATUSES.length) break
      }
      if (targets.length >= STATUSES.length) break
    }
    if (targets.length >= STATUSES.length) break
  }
  for (const [k, { story, group }] of targets.entries()) {
    // Жалуется тот, кто сторис видит: однокурсник, не автор и не из пары блокировки шага 50
    // (первый и последний в группе).
    const reporterId = group.studentIds.find(
      (uid, i) => uid !== story.authorId && i > 0 && i < group.studentIds.length - 1,
    )
    if (!reporterId) continue
    const status = STATUSES[k % STATUSES.length]
    const createdAt = between(random, story.createdAt)
    const complaintId = id(index, 'cmp', 'story', k)
    const decision = closing(status, k, createdAt)
    await writer.add('complaint', {
      id: complaintId,
      reporterId,
      targetType: 'STORY',
      targetId: story.id,
      reason: STORY_COMPLAINT_REASONS[k % STORY_COMPLAINT_REASONS.length],
      priority: 'MEDIUM',
      universityId: story.universityId ?? uniId,
      ...decision,
      createdAt,
    })
    complaints += 1
    if (status === 'RESOLVED') {
      warnings.push({
        id: child(complaintId, 'warn'),
        userId: story.authorId,
        issuedById: decision.resolvedById,
        complaintId,
        createdAt: decision.resolvedAt,
      })
    }
  }

  // ── Жалобы на комментарии к постам вуза: приоритет LOW ─────────────────────
  const comments = await prisma.comment.findMany({
    where: {
      deletedAt: null,
      post: { universityId: uniId, audience: 'UNIVERSITY', status: 'PUBLISHED', deletedAt: null },
    },
    select: { id: true, authorId: true, createdAt: true },
    orderBy: { id: 'asc' },
    take: STATUSES.length,
  })
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  for (const [k, comment] of comments.entries()) {
    const reporterId = [allStudents[k * 7 + 1], allStudents[k * 7 + 2]].find(
      (uid) => uid && uid !== comment.authorId,
    )
    if (!reporterId) continue
    const status = STATUSES[(k + 1) % STATUSES.length]
    const createdAt = between(random, comment.createdAt)
    await writer.add('complaint', {
      id: id(index, 'cmp', 'cmt', k),
      reporterId,
      targetType: 'COMMENT',
      targetId: comment.id,
      reason: COMMENT_COMPLAINT_REASONS[k % COMMENT_COMPLAINT_REASONS.length],
      priority: 'LOW',
      universityId: uniId,
      ...closing(status, k, createdAt),
      createdAt,
    })
    complaints += 1
  }
  await writer.flush()

  // Предупреждения — после жалоб: ModerationWarning.complaintId ссылается на них.
  for (const warning of warnings) await writer.add('moderationWarning', warning)
  await writer.flush()
  return { storyComplaints: complaints }
}
