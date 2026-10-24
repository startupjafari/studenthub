import { LoanStatus, type Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  PD_RETENTION_DAYS,
  PdRetentionService,
  departedStudentWhere,
  retentionCutoff,
} from './pd-retention.service'

type Mock = jest.Mock

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = PD_RETENTION_DAYS * DAY_MS

function model() {
  return {
    count: jest.fn(async () => 0) as Mock,
    findMany: jest.fn(async () => []) as Mock,
    deleteMany: jest.fn(async () => ({ count: 0 })) as Mock,
    updateMany: jest.fn(async () => ({ count: 0 })) as Mock,
  }
}

function makeService() {
  const prisma = {
    loan: model(),
    libraryIdAccessLog: model(),
    cameraViewSession: model(),
    securityPass: model(),
    securityVisitor: model(),
    grade: model(),
    examResult: model(),
    attendance: model(),
    submission: model(),
    application: model(),
    documentSubmission: model(),
    message: model(),
    scheduledMessage: model(),
    chatMember: model(),
    document: model(),
    file: model(),
    user: { ...model(), findUnique: jest.fn(async () => null) as Mock },
    documentAccess: model(),
    $executeRaw: jest.fn(async () => 0) as Mock,
    // Транзакция в тесте — тот же клиент: проверяем, какие запросы в ней идут.
    $transaction: jest.fn() as Mock,
  }
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prisma),
  )
  const audit = { record: jest.fn(async () => undefined) as Mock }
  const users = { softDeleteSelf: jest.fn(async () => undefined) as Mock }
  const service = new PdRetentionService(prisma as never, audit as never, users as never)
  return { service, prisma, audit, users }
}

/** Граница срока из условия: ровно год назад от момента вызова (с допуском на ход теста). */
function expectYearAgo(date: Date, before: number) {
  expect(date.getTime()).toBeGreaterThanOrEqual(before - YEAR_MS)
  expect(date.getTime()).toBeLessThanOrEqual(Date.now() - YEAR_MS)
}

/**
 * Мини-исполнитель условия `departedStudentWhere` над строкой пользователя — как его поймёт
 * база: `in` по роли и `lt` по дате, NULL под `lt` не попадает.
 */
function matchesDeparted(
  user: { role: Role; leftUniversityAt: Date | null },
  where: Prisma.UserWhereInput,
): boolean {
  const roles = (where.role as { in: Role[] }).in
  const lt = (where.leftUniversityAt as { lt: Date }).lt
  return roles.includes(user.role) && user.leftUniversityAt !== null && user.leftUniversityAt < lt
}

describe('departedStudentWhere — кого считает ушедшим больше года назад', () => {
  const now = Date.now()
  const cutoff = retentionCutoff(now)
  const where = departedStudentWhere(cutoff)
  const ago = (days: number) => new Date(now - days * DAY_MS)

  it('действующий студент (даты ухода нет) не задет', () => {
    expect(matchesDeparted({ role: Role.STUDENT, leftUniversityAt: null }, where)).toBe(false)
  })

  it('ушедший меньше года назад ещё не задет', () => {
    expect(matchesDeparted({ role: Role.STUDENT, leftUniversityAt: ago(200) }, where)).toBe(false)
    expect(matchesDeparted({ role: Role.STUDENT, leftUniversityAt: ago(364) }, where)).toBe(false)
  })

  it('ушедший больше года назад — студент и староста', () => {
    expect(matchesDeparted({ role: Role.STUDENT, leftUniversityAt: ago(366) }, where)).toBe(true)
    expect(matchesDeparted({ role: Role.STAROSTA, leftUniversityAt: ago(800) }, where)).toBe(true)
  })

  it('выпускник, ставший сотрудником, не задет — по роли', () => {
    expect(matchesDeparted({ role: Role.TEACHER, leftUniversityAt: ago(800) }, where)).toBe(false)
  })
})

describe('PdRetentionService.purgeClosedLoans', () => {
  it('dry-run: только считает закрытые больше года назад, ничего не удаляет', async () => {
    const { service, prisma, audit } = makeService()
    prisma.loan.count.mockResolvedValue(7)
    const before = Date.now()

    await expect(service.purgeClosedLoans(true)).resolves.toEqual({ Loan: 7 })

    const where = prisma.loan.count.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { status: LoanStatus.RETURNED, returnedAt: { lt: expect.any(Date) } },
      // Утеря — только погашенная и считая от погашения: непогашенный долг не исчезает.
      { status: LoanStatus.LOST, lostSettledAt: { lt: expect.any(Date) } },
      { status: LoanStatus.CANCELLED, cancelledAt: { lt: expect.any(Date) } },
    ])
    expectYearAgo(where.OR[0].returnedAt.lt, before)
    expectYearAgo(where.OR[1].lostSettledAt.lt, before)
    expectYearAgo(where.OR[2].cancelledAt.lt, before)
    // Открытая выдача (долг) в условие не попадает никогда — статуса OPEN там нет.
    expect(JSON.stringify(where)).not.toContain(LoanStatus.OPEN)
    expect(prisma.loan.findMany).not.toHaveBeenCalled()
    expect(prisma.loan.deleteMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('боевой прогон: удаляет пачку, повторяя условие срока, и пишет сводку в аудит', async () => {
    const { service, prisma, audit } = makeService()
    prisma.loan.findMany.mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }])
    prisma.loan.deleteMany.mockResolvedValue({ count: 2 })

    await expect(service.purgeClosedLoans(false)).resolves.toEqual({ Loan: 2 })

    const del = prisma.loan.deleteMany.mock.calls[0][0].where
    expect(del.id).toEqual({ in: ['l1', 'l2'] })
    expect(del.OR).toHaveLength(3)
    expect(prisma.loan.count).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith({
      action: 'pd_retention_purged',
      metadata: { task: 'purgeClosedLoans', counts: { Loan: 2 } },
    })
  })

  it('удалять нечего — аудит не пишется', async () => {
    const { service, audit } = makeService()
    await expect(service.purgeClosedLoans(false)).resolves.toEqual({ Loan: 0 })
    expect(audit.record).not.toHaveBeenCalled()
  })
})

describe('PdRetentionService.purgeViewLogs', () => {
  it('журналы просмотров — по дате записи, старше года', async () => {
    const { service, prisma } = makeService()
    prisma.libraryIdAccessLog.count.mockResolvedValue(3)
    prisma.cameraViewSession.count.mockResolvedValue(4)
    prisma.securityPass.count.mockResolvedValue(5)
    prisma.securityVisitor.count.mockResolvedValue(6)
    const before = Date.now()

    await expect(service.purgeViewLogs(true)).resolves.toEqual({
      LibraryIdAccessLog: 3,
      CameraViewSession: 4,
      SecurityPass: 5,
      SecurityVisitor: 6,
    })
    expectYearAgo(prisma.securityPass.count.mock.calls[0][0].where.createdAt.lt, before)
    expectYearAgo(prisma.securityVisitor.count.mock.calls[0][0].where.enteredAt.lt, before)
    expect(prisma.securityPass.deleteMany).not.toHaveBeenCalled()
    expectYearAgo(prisma.libraryIdAccessLog.count.mock.calls[0][0].where.createdAt.lt, before)
    expectYearAgo(prisma.cameraViewSession.count.mock.calls[0][0].where.startedAt.lt, before)
    expect(prisma.libraryIdAccessLog.deleteMany).not.toHaveBeenCalled()
    expect(prisma.cameraViewSession.deleteMany).not.toHaveBeenCalled()
  })
})

describe('PdRetentionService.purgeDepartedAcademicRecords', () => {
  it('отбирает строки только ушедших больше года назад студентов', async () => {
    const { service, prisma } = makeService()
    const before = Date.now()

    await service.purgeDepartedAcademicRecords(true)

    for (const m of [prisma.grade, prisma.examResult, prisma.attendance, prisma.submission]) {
      const where = m.count.mock.calls[0][0].where
      expect(where.student.role).toEqual({ in: [Role.STUDENT, Role.STAROSTA] })
      expectYearAgo(where.student.leftUniversityAt.lt, before)
      expect(m.deleteMany).not.toHaveBeenCalled()
    }
  })

  it('боевой прогон: условие ухода повторяется в DELETE — восстановленного не заденет', async () => {
    const { service, prisma } = makeService()
    prisma.grade.findMany.mockResolvedValueOnce([{ id: 'g1' }])
    prisma.grade.deleteMany.mockResolvedValue({ count: 1 })

    const counts = await service.purgeDepartedAcademicRecords(false)

    expect(counts).toEqual({ Grade: 1, ExamResult: 0, Attendance: 0, Submission: 0 })
    const where = prisma.grade.deleteMany.mock.calls[0][0].where
    expect(where.id).toEqual({ in: ['g1'] })
    expect(where.student.leftUniversityAt.lt).toBeInstanceOf(Date)
  })
})

describe('PdRetentionService.purgeDepartedApplications', () => {
  it('заявки и комплекты документов ушедших студентов', async () => {
    const { service, prisma } = makeService()
    prisma.application.count.mockResolvedValue(2)
    prisma.documentSubmission.count.mockResolvedValue(1)

    await expect(service.purgeDepartedApplications(true)).resolves.toEqual({
      Application: 2,
      DocumentSubmission: 1,
    })
    expect(prisma.application.count.mock.calls[0][0].where.student.role).toEqual({
      in: [Role.STUDENT, Role.STAROSTA],
    })
  })
})

describe('PdRetentionService.purgeDepartedMessages', () => {
  it('dry-run: считает сообщения, вложения, отложенные и черновики, не трогая ничего', async () => {
    const { service, prisma } = makeService()
    prisma.message.count.mockResolvedValue(10)
    prisma.file.count.mockResolvedValue(3)
    prisma.scheduledMessage.count.mockResolvedValue(1)
    prisma.chatMember.count.mockResolvedValue(2)

    await expect(service.purgeDepartedMessages(true)).resolves.toEqual({
      Message: 10,
      ScheduledMessage: 1,
      'ChatMember.draft': 2,
      File: 3,
    })
    expect(
      prisma.file.count.mock.calls[0][0].where.message.sender.leftUniversityAt.lt,
    ).toBeInstanceOf(Date)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.message.deleteMany).not.toHaveBeenCalled()
    expect(prisma.file.deleteMany).not.toHaveBeenCalled()
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })

  it('боевой прогон: вложения, затем цитаты в чужих ответах, затем сами сообщения', async () => {
    const { service, prisma } = makeService()
    // Выборка пачки, затем перечитывание под транзакцией: m2 за это время «восстановили».
    prisma.message.findMany
      .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }])
      .mockResolvedValueOnce([{ id: 'm1' }])
    prisma.file.deleteMany.mockResolvedValue({ count: 2 })
    prisma.message.deleteMany.mockResolvedValue({ count: 1 })

    const counts = await service.purgeDepartedMessages(false)

    expect(counts.Message).toBe(1)
    expect(counts.File).toBe(2)
    expect(prisma.file.deleteMany).toHaveBeenCalledWith({ where: { messageId: { in: ['m1'] } } })
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { replyToId: { in: ['m1'] }, replyQuote: { not: null } },
      data: { replyQuote: null },
    })
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['m1'] } } })
    // Чужие сообщения не отбираются: условие — отправитель ушедший.
    const pick = prisma.message.findMany.mock.calls[0][0].where
    expect(pick.sender.role).toEqual({ in: [Role.STUDENT, Role.STAROSTA] })
  })

  it('черновики ушедшего стираются, а не удаляется членство в чате', async () => {
    const { service, prisma } = makeService()
    prisma.chatMember.findMany.mockResolvedValueOnce([{ id: 'cm1' }])
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })

    await service.purgeDepartedMessages(false)

    expect(prisma.chatMember.updateMany.mock.calls[0][0].data).toEqual({ draft: null })
    expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
  })
})

describe('PdRetentionService.purgeDepartedDocuments', () => {
  it('боевой прогон: сканы — по документу (у выданной справки файл на сотруднике)', async () => {
    const { service, prisma } = makeService()
    prisma.document.findMany
      .mockResolvedValueOnce([{ id: 'd1' }])
      .mockResolvedValueOnce([{ id: 'd1' }])
    prisma.file.deleteMany.mockResolvedValue({ count: 2 })
    prisma.document.deleteMany.mockResolvedValue({ count: 1 })

    await expect(service.purgeDepartedDocuments(false)).resolves.toEqual({ Document: 1, File: 2 })
    expect(prisma.file.deleteMany).toHaveBeenCalledWith({ where: { documentId: { in: ['d1'] } } })
    expect(
      prisma.document.findMany.mock.calls[0][0].where.owner.leftUniversityAt.lt,
    ).toBeInstanceOf(Date)
  })

  it('dry-run ничего не удаляет', async () => {
    const { service, prisma } = makeService()
    prisma.document.count.mockResolvedValue(5)
    prisma.file.count.mockResolvedValue(9)

    await expect(service.purgeDepartedDocuments(true)).resolves.toEqual({ Document: 5, File: 9 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('PdRetentionService.purgeDepartedProfiles', () => {
  it('dry-run: считает живые профили ушедших, softDeleteSelf не зовёт', async () => {
    const { service, prisma, users } = makeService()
    prisma.user.count.mockResolvedValue(4)

    await expect(service.purgeDepartedProfiles(true)).resolves.toEqual({ User: 4 })
    expect(prisma.user.count.mock.calls[0][0].where.deletedAt).toBeNull()
    expect(users.softDeleteSelf).not.toHaveBeenCalled()
  })

  it('боевой прогон: штатное удаление; сбой одного не останавливает остальных', async () => {
    const { service, prisma, users, audit } = makeService()
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
      .mockResolvedValueOnce([])
    users.softDeleteSelf.mockImplementation(async (id: string) => {
      if (id === 'u2') throw new Error('minio down')
    })

    await expect(service.purgeDepartedProfiles(false)).resolves.toEqual({
      User: 2,
      'User.failed': 1,
    })
    expect(users.softDeleteSelf.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2', 'u3'])
    // Повторная выборка обходит сбойный аккаунт — иначе цикл крутился бы на нём.
    expect(prisma.user.findMany.mock.calls[1][0].where.id).toEqual({ notIn: ['u2'] })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pd_retention_purged',
        metadata: expect.objectContaining({ userIds: ['u1', 'u3'] }),
      }),
    )
  })
})

describe('PdRetentionService.purgeAccountTombstones', () => {
  const noBlockers = {
    _count: {
      gradeColumnsMade: 0,
      examsCreated: 0,
      assignmentsCreated: 0,
      materials: 0,
      scheduleChangesCreated: 0,
      documentRequestsAuthored: 0,
      eventsOrganized: 0,
      consultationSlots: 0,
    },
  }

  it('отбирает удалённых больше года назад, курсором по id', async () => {
    const { service, prisma } = makeService()
    const before = Date.now()

    await service.purgeAccountTombstones(true)

    const where = prisma.user.findMany.mock.calls[0][0].where
    expectYearAgo(where.deletedAt.lt, before)
    expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' })
  })

  it('dry-run: считает, кого удалил бы и кто заблокирован, ничего не удаляя', async () => {
    const { service, prisma } = makeService()
    prisma.user.count.mockResolvedValue(3)
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([])
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'b'
        ? { _count: { ...noBlockers._count, gradeColumnsMade: 4, examsCreated: 1 } }
        : noBlockers,
    )
    prisma.file.count.mockImplementation(async ({ where }: { where: { ownerId: string } }) =>
      where.ownerId === 'c' ? 1 : 0,
    )

    await expect(service.purgeAccountTombstones(true)).resolves.toEqual({
      'User.tombstones': 3,
      User: 1,
      'blocked.gradeColumnsMade': 1,
      'blocked.examsCreated': 1,
      'blocked.foreignFiles': 1,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.user.deleteMany).not.toHaveBeenCalled()
    // Второй запрос продолжает после последнего проверенного, а не с начала.
    expect(prisma.user.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'c' })
  })

  it('боевой прогон: переписывает чужие сканы, стирает цитаты и гранты, удаляет строку', async () => {
    const { service, prisma, audit } = makeService()
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }]).mockResolvedValueOnce([])
    prisma.user.findUnique.mockResolvedValue(noBlockers)
    prisma.user.deleteMany.mockResolvedValue({ count: 1 })

    const counts = await service.purgeAccountTombstones(false)

    expect(counts.User).toBe(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const sql = (prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?')
    expect(sql).toContain('UPDATE "files"')
    expect(sql).toContain('d."owner_id" <>')
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { replyTo: { senderId: 'u1' }, replyQuote: { not: null } },
      data: { replyQuote: null },
    })
    expect(prisma.documentAccess.deleteMany).toHaveBeenCalledWith({
      where: { granteeType: 'USER', granteeId: 'u1' },
    })
    const del = prisma.user.deleteMany.mock.calls[0][0].where
    expect(del.id).toBe('u1')
    expect(del.deletedAt.lt).toBeInstanceOf(Date)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ task: 'purgeAccountTombstones', userIds: ['u1'] }),
      }),
    )
  })

  it('заблокированный (автор колонок журнала) не удаляется — оценки группы целы', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValueOnce([{ id: 't1' }]).mockResolvedValueOnce([])
    prisma.user.findUnique.mockResolvedValue({
      _count: { ...noBlockers._count, gradeColumnsMade: 2 },
    })

    const counts = await service.purgeAccountTombstones(false)

    expect(counts).toMatchObject({ User: 0, 'blocked.gradeColumnsMade': 1 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('владелец чужих файлов (обложка книги) не удаляется', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'lib' }]).mockResolvedValueOnce([])
    prisma.user.findUnique.mockResolvedValue(noBlockers)
    prisma.file.count.mockResolvedValue(1)

    const counts = await service.purgeAccountTombstones(false)

    expect(counts).toMatchObject({ User: 0, 'blocked.foreignFiles': 1 })
    const where = prisma.file.count.mock.calls[0][0].where
    expect(where.ownerId).toBe('lib')
    expect(where.OR).toContainEqual({ bookCovers: { some: {} } })
    expect(prisma.user.deleteMany).not.toHaveBeenCalled()
  })

  it('сбой одного удаления не останавливает остальных', async () => {
    const { service, prisma } = makeService()
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'x' }, { id: 'y' }]).mockResolvedValueOnce([])
    prisma.user.findUnique.mockResolvedValue(noBlockers)
    prisma.user.deleteMany
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ count: 1 })

    await expect(service.purgeAccountTombstones(false)).resolves.toMatchObject({
      User: 1,
      'User.failed': 1,
    })
  })
})
