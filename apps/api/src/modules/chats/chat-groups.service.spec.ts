import { Role } from '@studenthub/shared-types'
import {
  DEFAULT_CHAT_PERMISSIONS,
  containsLink,
  messagePermissionNeeds,
  resolveChatPermissions,
  type ChatPermissions,
} from '@studenthub/shared-schemas'
import { ChatsService } from './chats.service'
import { ChatGroupsService } from './chat-groups.service'
import { ChatGateway } from './chats.gateway'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Группы как в Telegram (§8.3): «Разрешения» во всех путях отправки, исключения для админов и
// владельца, заявки на вступление, тип группы, исключённые и ранг владельца в составе.

const OWNER = 'owner'
const ADMIN = 'admin'
const MEMBER = 'member'

interface ChatRow {
  id: string
  type: string
  title: string
  createdById: string | null
  permissions: Partial<ChatPermissions> | null
  requestPendingForId: null
  inviteCode: string
  joinByLink: boolean
  joinApproval: boolean
  avatarUrl: string | null
  members: unknown[]
}

function setup(chatOver: Partial<ChatRow> = {}) {
  const chat: ChatRow = {
    id: 'c1',
    type: 'GROUP',
    title: 'Группа',
    createdById: OWNER,
    permissions: null,
    requestPendingForId: null,
    inviteCode: 'code',
    joinByLink: true,
    joinApproval: false,
    avatarUrl: null,
    members: [],
    ...chatOver,
  }
  // Участник: админы — ADMIN и владелец (создатель — админ по умолчанию), остальные —
  // рядовые; никто не забанен.
  const memberRow = (userId: string | undefined) =>
    userId === undefined
      ? null
      : {
          id: `m-${userId}`,
          bannedAt: null,
          isAdmin: userId === ADMIN || userId === OWNER,
          clearedAt: null,
        }
  const prisma = {
    chat: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(chat)),
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(chat)),
      update: jest.fn().mockImplementation(({ data }: { data: Partial<ChatRow> }) => {
        Object.assign(chat, data)
        return Promise.resolve(chat)
      }),
    },
    chatMember: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { chatId_userId: { userId: string } } }) =>
          Promise.resolve(memberRow(where.chatId_userId.userId)),
        ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chatJoinRequest: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'r1' }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chatRemovedMember: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'sys' }),
      findUniqueOrThrow: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'x', firstName: 'И', lastName: 'Ф' }),
    },
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    scheduledMessage: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma),
  )
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    leaveRoom: jest.fn(),
    onlineAmong: jest.fn().mockReturnValue([]),
  }
  const files = {
    presignPut: jest.fn().mockResolvedValue({ url: 'u' }),
    startMultipart: jest.fn().mockResolvedValue({}),
    upload: jest.fn(),
    confirmDirectUpload: jest.fn(),
  }
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const posts = { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as never,
    realtime as unknown as RealtimeGateway,
    files as never,
    posts as never,
    {} as never,
    { get: jest.fn().mockReturnValue('chat-media') } as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  const groups = new ChatGroupsService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    service,
  )
  return { service, groups, prisma, realtime, files, queue, chat }
}

const viewer = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

/** Отказ CHAT_PERMISSION_DENIED с названием права в details[0].field. */
function denied(field: string) {
  return expect.objectContaining({
    code: 'CHAT_PERMISSION_DENIED',
    details: [expect.objectContaining({ field })],
  })
}

const closed = (over: Partial<ChatPermissions>) => ({ ...DEFAULT_CHAT_PERMISSIONS, ...over })

describe('Права группы: общие правила (shared-schemas)', () => {
  it('выключенное «писать» гасит медиа, ссылки и опросы, но не закреп и состав', () => {
    const p = resolveChatPermissions({ sendMessages: false, addMembers: true })
    expect(p).toMatchObject({
      sendMessages: false,
      sendMedia: false,
      embedLinks: false,
      sendPolls: false,
      addMembers: true,
      pinMessages: true,
    })
  })

  it('мусор в хранимом значении не ломает права — берутся умолчания', () => {
    expect(resolveChatPermissions('x')).toEqual(DEFAULT_CHAT_PERMISSIONS)
    expect(resolveChatPermissions({ sendMedia: 'no', extra: true })).toEqual(
      DEFAULT_CHAT_PERMISSIONS,
    )
  })

  it('ссылка — http(s) и www.; нужные права — по содержимому', () => {
    expect(containsLink('см. https://example.com')).toBe(true)
    expect(containsLink('www.example.com')).toBe(true)
    expect(containsLink('просто example.com')).toBe(false)
    expect(messagePermissionNeeds({ text: 'www.x.kz', media: true })).toEqual([
      'sendMessages',
      'sendMedia',
      'embedLinks',
    ])
  })
})

describe('Права группы во всех путях отправки', () => {
  it('WS/REST текст: «писать» выключено → CHAT_PERMISSION_DENIED', async () => {
    const { service } = setup({ permissions: closed({ sendMessages: false }) })
    await expect(
      service.createMessage(MEMBER, { chatId: 'c1', content: 'привет' }),
    ).rejects.toEqual(denied('sendMessages'))
  })

  it('текст со ссылкой при запрете ссылок → отказ, без ссылки — проверка проходит', async () => {
    const { service, prisma } = setup({ permissions: closed({ embedLinks: false }) })
    await expect(
      service.createMessage(MEMBER, { chatId: 'c1', content: 'тут https://x.kz' }),
    ).rejects.toEqual(denied('embedLinks'))
    // Без ссылки отказ уже не про права: дальше идёт транзакция создания.
    prisma.$transaction.mockRejectedValueOnce(new Error('дальше прав'))
    await expect(service.createMessage(MEMBER, { chatId: 'c1', content: 'тут' })).rejects.toThrow(
      'дальше прав',
    )
  })

  it('отложенное сообщение: проверка и при постановке (ссылка запрещена)', async () => {
    const { service } = setup({ permissions: closed({ embedLinks: false }) })
    await expect(
      service.scheduleMessage(MEMBER, 'c1', {
        content: 'www.x.kz',
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toEqual(denied('embedLinks'))
  })

  it('вложения REST (multipart), прямая загрузка и подпись ссылок — запрет медиа', async () => {
    const { service, files } = setup({ permissions: closed({ sendMedia: false }) })
    await expect(
      service.sendMessageRest(MEMBER, { chatId: 'c1', content: '' }, [
        { buffer: Buffer.from('x') },
      ]),
    ).rejects.toEqual(denied('sendMedia'))
    await expect(
      service.sendMessageFromUploads(MEMBER, 'c1', { attachments: [{ key: `${MEMBER}/k` }] }),
    ).rejects.toEqual(denied('sendMedia'))
    await expect(service.presignAttachment(MEMBER, 'c1', 'image/png')).rejects.toEqual(
      denied('sendMedia'),
    )
    await expect(
      service.startAttachmentMultipart(MEMBER, 'c1', 'video/mp4', 100_000_000),
    ).rejects.toEqual(denied('sendMedia'))
    expect(files.upload).not.toHaveBeenCalled()
    expect(files.presignPut).not.toHaveBeenCalled()
  })

  it('опрос и чек-лист — право «опросы»', async () => {
    const { service } = setup({ permissions: closed({ sendPolls: false }) })
    await expect(
      service.createPoll(MEMBER, 'c1', { question: 'Q?', options: ['a', 'b'] }),
    ).rejects.toEqual(denied('sendPolls'))
    await expect(
      service.sendChecklist(MEMBER, 'c1', { title: 'Дела', items: ['раз'] }),
    ).rejects.toEqual(denied('sendPolls'))
  })

  it('геопозиция — право «писать»', async () => {
    const muted = setup({ permissions: closed({ sendMessages: false }) })
    await expect(
      muted.service.sendLocation(MEMBER, 'c1', { lat: 43.2, lng: 76.9 }),
    ).rejects.toEqual(denied('sendMessages'))
  })

  it('пересылка — по содержимому источника: альбом при запрете медиа', async () => {
    const { service, prisma } = setup({ permissions: closed({ sendMedia: false }) })
    prisma.message.findFirst.mockResolvedValue({
      id: 'src',
      chatId: 'c2',
      content: '',
      media: [{ id: 'f1' }],
      poll: null,
      checklist: null,
      sharedPostId: null,
    })
    await expect(service.forwardMessage(viewer(MEMBER), 'c1', 'src')).rejects.toEqual(
      denied('sendMedia'),
    )
  })

  it('пересылка пачкой: чат с запретом — ok:false с кодом, сообщения не создаются', async () => {
    const { service, prisma } = setup({ permissions: closed({ sendPolls: false }) })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 'src',
        chatId: 'c2',
        seq: 1,
        createdAt: new Date(),
        content: 'Q?',
        media: [],
        poll: { question: 'Q?' },
        checklist: null,
        sharedPostId: null,
      },
    ])
    const res = await service.forwardBatch(viewer(MEMBER), {
      requestId: 'req-1',
      messageIds: ['src'],
      chatIds: ['c1'],
    })
    expect(res.results).toEqual([
      { chatId: 'c1', ok: false, messageIds: [], code: 'CHAT_PERMISSION_DENIED' },
    ])
  })

  it('поделиться постом с подписью при запрете «писать»', async () => {
    const { service } = setup({ permissions: closed({ sendMessages: false }) })
    await expect(service.sharePost(viewer(MEMBER), 'c1', 'p1', 'смотрите')).rejects.toEqual(
      denied('sendMessages'),
    )
  })

  it('правка: вписать ссылку при запрете ссылок нельзя', async () => {
    const { service, prisma } = setup({ permissions: closed({ embedLinks: false }) })
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: MEMBER,
      createdAt: new Date(),
      forwardedFromId: null,
      content: 'было',
      systemType: null,
      poll: null,
      checklist: null,
      location: null,
      contact: null,
    })
    await expect(service.editMessage(MEMBER, 'm1', 'стало https://x.kz')).rejects.toEqual(
      denied('embedLinks'),
    )
  })

  it('закреп и «открепить все» — право «закреплять»', async () => {
    const { service, prisma } = setup({ permissions: closed({ pinMessages: false }) })
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    await expect(service.setPinned(MEMBER, 'm1', true)).rejects.toEqual(denied('pinMessages'))
    await expect(service.setPinned(MEMBER, 'm1', false)).rejects.toEqual(denied('pinMessages'))
    await expect(service.unpinAllMessages(MEMBER, 'c1')).rejects.toEqual(denied('pinMessages'))
  })

  it('отметка пункта чек-листа и движение трансляции правами отправки не ограничены', async () => {
    const { service } = setup({ permissions: closed({ sendMessages: false }) })
    await expect(service.assertCanAct(MEMBER, 'c1')).resolves.toBeUndefined()
  })

  it('админа и владельца ограничения не касаются', async () => {
    const { service } = setup({
      permissions: closed({ sendMessages: false, pinMessages: false }),
    })
    for (const who of [ADMIN, OWNER]) {
      await expect(
        service.assertGroupPermission('c1', who, ['sendMessages', 'sendMedia', 'pinMessages']),
      ).resolves.toBeUndefined()
    }
    await expect(service.assertGroupPermission('c1', MEMBER, ['sendMedia'])).rejects.toEqual(
      denied('sendMedia'),
    )
  })

  it('официальные и личные чаты правами групп не ограничиваются', async () => {
    const { service } = setup({
      type: 'FACULTY',
      permissions: closed({ sendMessages: false }),
    })
    await expect(service.assertGroupPermission('c1', MEMBER, ['sendMessages'])).resolves.toBe(
      undefined,
    )
  })
})

describe('Права группы на действия админа', () => {
  it('добавлять участников рядовому — только с правом addMembers', async () => {
    const { service } = setup()
    await expect(service.addMember(viewer(MEMBER), 'c1', 'u2')).rejects.toEqual(
      denied('addMembers'),
    )
  })

  it('менять название рядовому — только с правом changeInfo', async () => {
    const closedInfo = setup()
    await expect(
      closedInfo.service.editChat(viewer(MEMBER), 'c1', { title: 'Новое' }),
    ).rejects.toEqual(denied('changeInfo'))

    const open = setup({ permissions: closed({ changeInfo: true }) })
    jest.spyOn(open.service, 'emitSystemMessage').mockResolvedValue(undefined)
    jest.spyOn(open.service, 'pingChatList').mockResolvedValue(undefined)
    await expect(open.service.editChat(viewer(MEMBER), 'c1', { title: 'Новое' })).resolves.toEqual(
      expect.objectContaining({ title: 'Новое' }),
    )
  })
})

describe('ChatGroupsService: «Разрешения» и тип группы', () => {
  it('админ меняет права: хранится выбор, наружу — с зависимостью; событие в комнату', async () => {
    const { groups, prisma, realtime } = setup()
    const res = await groups.updatePermissions(viewer(ADMIN), 'c1', { sendMessages: false })
    // В базе медиа осталось включённым — включат «писать» обратно, и оно вернётся.
    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { permissions: expect.objectContaining({ sendMessages: false, sendMedia: true }) },
    })
    expect(res.permissions).toMatchObject({ sendMessages: false, sendMedia: false })
    expect(realtime.emitToRoom).toHaveBeenCalledWith(
      'chat:c1',
      'chat:permissions',
      expect.objectContaining({ chatId: 'c1', joinByLink: true }),
    )
  })

  it('рядовой участник права не меняет', async () => {
    const { groups } = setup()
    await expect(
      groups.updatePermissions(viewer(MEMBER), 'c1', { sendMedia: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('тип группы: закрытая — ссылка не работает', async () => {
    const { groups, service } = setup()
    await groups.updateJoinSettings(viewer(OWNER), 'c1', { joinByLink: false })
    await expect(service.joinByInvite(viewer('u9'), 'c1', 'code')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('Заявки на вступление', () => {
  it('с одобрением ссылка создаёт заявку, а не участника; админам — сигнал и уведомление', async () => {
    const { service, prisma, realtime, queue } = setup({ joinApproval: true })
    prisma.chatMember.findUnique.mockImplementation(
      ({ where }: { where: { chatId_userId: { userId: string } } }) =>
        Promise.resolve(where.chatId_userId.userId === 'u9' ? null : { isAdmin: true }),
    )
    prisma.chatMember.findMany.mockResolvedValue([{ userId: ADMIN }])
    const res = await service.joinByInvite(viewer('u9'), 'c1', 'code')
    expect(res).toEqual(expect.objectContaining({ id: 'c1', requested: true }))
    expect(prisma.chatJoinRequest.create).toHaveBeenCalledWith({
      data: { chatId: 'c1', userId: 'u9' },
    })
    expect(prisma.chatMember.create).not.toHaveBeenCalled()
    const signalled = realtime.emitToUser.mock.calls
      .filter((c) => c[1] === 'chat:join-requests')
      .map((c) => c[0])
    expect(signalled.sort()).toEqual([ADMIN, OWNER].sort())
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ titleKey: 'chats.joinRequest.title' }),
      expect.anything(),
    )
  })

  it('одобрение: участник появляется, заявка и «исключён» снимаются', async () => {
    const { groups, service, prisma } = setup()
    prisma.chatMember.findUnique.mockImplementation(
      ({ where }: { where: { chatId_userId: { userId: string } } }) =>
        Promise.resolve(
          where.chatId_userId.userId === 'u9' ? null : { isAdmin: true, bannedAt: null },
        ),
    )
    const sys = jest.spyOn(service, 'emitSystemMessage').mockResolvedValue(undefined)
    await expect(groups.approveJoinRequest(viewer(ADMIN), 'c1', 'u9')).resolves.toEqual({
      chatId: 'c1',
      userId: 'u9',
      approved: true,
    })
    expect(prisma.chatMember.create).toHaveBeenCalled()
    expect(prisma.chatJoinRequest.deleteMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', userId: 'u9' },
    })
    expect(prisma.chatRemovedMember.deleteMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', userId: 'u9' },
    })
    expect(sys).toHaveBeenCalledWith('c1', 'u9', 'member_joined')
  })

  it('отклонить несуществующую заявку — NOT_FOUND', async () => {
    const { groups, prisma } = setup()
    prisma.chatJoinRequest.deleteMany.mockResolvedValue({ count: 0 })
    await expect(groups.declineJoinRequest(viewer(ADMIN), 'c1', 'u9')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('Состав группы', () => {
  it('исключение пишет строку «Удалённые» с тем, кто исключил', async () => {
    const { service, prisma } = setup()
    jest.spyOn(service, 'emitSystemMessage').mockResolvedValue(undefined)
    jest.spyOn(service, 'pingChatList').mockResolvedValue(undefined)
    await service.removeMember(viewer(OWNER), 'c1', 'u2')
    expect(prisma.chatRemovedMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chatId_userId: { chatId: 'c1', userId: 'u2' } },
        create: { chatId: 'c1', userId: 'u2', removedById: OWNER },
      }),
    )
  })

  it('GET members отдаёт isOwner у владельца — не только самому владельцу', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue(
      [OWNER, MEMBER].map((id) => ({
        userId: id,
        createdAt: new Date(),
        bannedAt: null,
        isAdmin: id === OWNER,
        user: {
          id,
          firstName: 'И',
          lastName: 'Ф',
          avatarUrl: null,
          role: 'STUDENT',
          lastSeenAt: null,
        },
      })),
    )
    jest
      .spyOn(
        service as unknown as { presenceVisible: () => Promise<Set<string>> },
        'presenceVisible',
      )
      .mockResolvedValue(new Set())
    const list = (await service.listMembers(viewer(MEMBER), 'c1')) as {
      id: string
      isOwner: boolean
    }[]
    expect(list.map((m) => [m.id, m.isOwner])).toEqual([
      [OWNER, true],
      [MEMBER, false],
    ])
  })
})

describe('Права группы через сокет (ChatGateway → ChatsService)', () => {
  it('message:send и message:edit при запрете отдают error с кодом CHAT_PERMISSION_DENIED', async () => {
    const { service, prisma } = setup({ permissions: closed({ embedLinks: false }) })
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: MEMBER,
      createdAt: new Date(),
      forwardedFromId: null,
      content: 'было',
      systemType: null,
      poll: null,
      checklist: null,
      location: null,
      contact: null,
    })
    const gateway = new ChatGateway(
      service,
      { maintenanceActive: jest.fn().mockResolvedValue(false) } as never,
      { admitSocket: jest.fn().mockResolvedValue(true) } as never,
    )
    const roomEmit = jest.fn()
    ;(gateway as unknown as { server: unknown }).server = {
      to: jest.fn().mockReturnValue({ emit: roomEmit }),
    }
    const client = {
      data: { userId: MEMBER, role: 'STUDENT' },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    }
    await gateway.onMessageSend(client as never, { chatId: 'c1', content: 'https://x.kz' })
    await gateway.onMessageEdit(client as never, { messageId: 'm1', content: 'www.x.kz' })
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:send',
      code: 'CHAT_PERMISSION_DENIED',
    })
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:edit',
      code: 'CHAT_PERMISSION_DENIED',
    })
    expect(roomEmit).not.toHaveBeenCalled()
  })
})
