import { SearchQuerySchema } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { SearchService } from './search.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function setup() {
  const many = () => ({ findMany: jest.fn().mockResolvedValue([]) })
  const prisma = {
    user: many(),
    course: many(),
    assignment: many(),
    material: many(),
    event: many(),
    chat: many(),
    userBlock: many(),
  }
  const service = new SearchService(prisma as unknown as PrismaService)
  return { service, prisma }
}

const platformAdmin: JwtPayload = {
  sub: 'pa',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
}

describe('SearchService — события', () => {
  it('студенту — только события своей аудитории, а не всего вуза', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'день')
    const where = prisma.event.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ OR: [{ universityId: 'uni-1' }, { audience: 'ALL' }] })
    const audiences = where.AND[1].OR
    expect(audiences).toContainEqual({ audience: 'FACULTY', facultyId: 'fac-1' })
    expect(audiences).toContainEqual({ audience: 'GROUP', groupId: 'grp-1' })
    expect(audiences.some((o: { audience?: string }) => o.audience === 'TEACHERS')).toBe(false)
  })

  // E-F23: события для всех заводит платформа, вуза у них нет — «свой вуз» их прятал.
  it('события для всех (ALL, без вуза) находятся, а не отсекаются условием вуза', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'олимпиада')
    const where = prisma.event.findMany.mock.calls[0][0].where
    expect(where.AND[0].OR).toContainEqual({ audience: 'ALL' })
    // Видимость по аудитории остаётся вторым условием: ALL там тоже разрешён.
    expect(where.AND[1].OR).toContainEqual({ audience: 'ALL' })
  })

  it('платформе — без ограничения вузом и аудиторией', async () => {
    const { service, prisma } = setup()
    await service.search(platformAdmin, 'день')
    expect(prisma.event.findMany.mock.calls[0][0].where).toEqual({
      title: { contains: 'день', mode: 'insensitive' },
    })
  })

  it('чаты — только где он участник и не забанен', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'чат')
    expect(prisma.chat.findMany.mock.calls[0][0].where.members).toEqual({
      some: { userId: 'stu-1', bannedAt: null },
    })
  })
})

// A-F16: логин — публичный @-хэндл для упоминаний, но перебирать логины вуза по
// подстроке («admin» в любом месте) автодополнению не нужно: ищем только по началу.
describe('SearchService — люди', () => {
  it('по логину — только с начала, по имени и фамилии — по подстроке', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'iva')
    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { firstName: { contains: 'iva', mode: 'insensitive' } },
      { lastName: { contains: 'iva', mode: 'insensitive' } },
      { username: { startsWith: 'iva', mode: 'insensitive' } },
    ])
    expect(where.universityId).toBe('uni-1')
  })

  it('личная блокировка в любую сторону прячет человека из выдачи', async () => {
    const { service, prisma } = setup()
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'stu-1', blockedId: 'u-blocked' },
      { blockerId: 'u-blocker', blockedId: 'stu-1' },
    ])
    await service.search(student, 'iva')
    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.id).toEqual({ notIn: ['u-blocked', 'u-blocker'] })
  })
})

// E-F27: scope курсов, заданий и материалов — по роли смотрящего.
describe('SearchService — scope учебных источников', () => {
  const teacher: JwtPayload = {
    sub: 't-1',
    role: Role.TEACHER,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
  }
  const dean: JwtPayload = {
    sub: 'd-1',
    role: Role.DEAN,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: null,
  }
  const platform = platformAdmin
  const inUni = { group: { is: { faculty: { is: { universityId: 'uni-1' } } } } }

  it('студенту — курсы и материалы своей группы, задания только опубликованные', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'мат')
    expect(prisma.course.findMany.mock.calls[0][0].where).toMatchObject({ groupId: 'grp-1' })
    expect(prisma.material.findMany.mock.calls[0][0].where).toMatchObject({ groupId: 'grp-1' })
    expect(prisma.assignment.findMany.mock.calls[0][0].where).toMatchObject({
      status: { in: ['PUBLISHED', 'CLOSED'] },
      course: { is: { groupId: 'grp-1' } },
    })
  })

  it('студенту без группы — ничего, а не весь вуз', async () => {
    const { service, prisma } = setup()
    await service.search({ ...student, groupId: null }, 'мат')
    expect(prisma.course.findMany.mock.calls[0][0].where.groupId).toBe('__none__')
    expect(prisma.material.findMany.mock.calls[0][0].where.groupId).toBe('__none__')
  })

  it('преподавателю — задания только своих курсов, курсы и материалы — своего вуза', async () => {
    const { service, prisma } = setup()
    await service.search(teacher, 'мат')
    expect(prisma.assignment.findMany.mock.calls[0][0].where).toMatchObject({
      course: { is: { teacherId: 't-1' } },
    })
    expect(prisma.course.findMany.mock.calls[0][0].where).toMatchObject(inUni)
    expect(prisma.material.findMany.mock.calls[0][0].where).toMatchObject(inUni)
  })

  it('декану — курсы, задания и материалы своего факультета, а не всего вуза', async () => {
    const { service, prisma } = setup()
    await service.search(dean, 'мат')
    const inFaculty = { group: { is: { facultyId: 'fac-1' } } }
    expect(prisma.course.findMany.mock.calls[0][0].where).toMatchObject(inFaculty)
    expect(prisma.assignment.findMany.mock.calls[0][0].where).toMatchObject({
      course: { is: inFaculty },
    })
    expect(prisma.material.findMany.mock.calls[0][0].where).toMatchObject(inFaculty)
  })

  it('декану без факультета — ничего, а не весь вуз', async () => {
    const { service, prisma } = setup()
    await service.search({ ...dean, facultyId: null }, 'мат')
    expect(prisma.course.findMany.mock.calls[0][0].where).toMatchObject({
      group: { is: { facultyId: '__none__' } },
    })
  })

  it('платформе — без scope, только по тексту', async () => {
    const { service, prisma } = setup()
    await service.search(platform, 'мат')
    const contains = { contains: 'мат', mode: 'insensitive' }
    expect(prisma.course.findMany.mock.calls[0][0].where).toEqual({
      subject: { is: { name: contains } },
    })
    expect(prisma.assignment.findMany.mock.calls[0][0].where).toEqual({ title: contains })
    expect(prisma.material.findMany.mock.calls[0][0].where).toEqual({ title: contains })
    expect(prisma.user.findMany.mock.calls[0][0].where.universityId).toBeUndefined()
  })
})

// E-F23: подсказке упоминаний нужны только люди — остальные пять источников не запрашиваются.
describe('SearchService — выбор источников (types)', () => {
  it('types=people — запрос только за людьми, остальные блоки пустые', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }])
    const res = await service.search(student, 'iva', ['people'])
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
    for (const source of ['course', 'assignment', 'material', 'event', 'chat'] as const) {
      expect(prisma[source].findMany).not.toHaveBeenCalled()
    }
    expect(res).toEqual({
      people: [{ id: 'u1' }],
      courses: [],
      assignments: [],
      materials: [],
      events: [],
      chats: [],
    })
  })

  it('без types — все шесть источников, как раньше', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'iva')
    for (const source of ['user', 'course', 'assignment', 'material', 'event', 'chat'] as const) {
      expect(prisma[source].findMany).toHaveBeenCalledTimes(1)
    }
  })

  it('схема запроса: types через запятую, повторы схлопываются, неизвестный источник — ошибка', () => {
    expect(SearchQuerySchema.parse({ q: 'iv', types: 'people, events,people' }).types).toEqual([
      'people',
      'events',
    ])
    expect(SearchQuerySchema.parse({ q: 'iv' }).types).toBeUndefined()
    expect(SearchQuerySchema.safeParse({ q: 'iv', types: 'users' }).success).toBe(false)
    // Короче двух символов — по-прежнему 422: подсказка не шлёт такой запрос вовсе.
    expect(SearchQuerySchema.safeParse({ q: 'i', types: 'people' }).success).toBe(false)
  })
})
