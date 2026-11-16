// Журнал документов вуза: каждое действие DOCUMENT_JOURNAL_ACTIONS и каждый путь доступа
// DOCUMENT_JOURNAL_VIA (packages/shared-schemas/src/documents.ts) хотя бы раз на вуз.
//
// Вызывается из шага 70 после того, как документы, сканы, запросы и заявки уже в базе.
// История каждого документа целиком стоила бы десятки строк на студента, а экрану журнала
// и истории документа нужны примеры, а не полнота. Поэтому сценарии разыгрываются на
// первых студентах вуза — по одному сценарию на студента, детерминированно.
//
// Метаданные событий — те же, что пишет API (documents.service, document-requests.service,
// application-documents.service): по ним journalVia решает, «через что» совершено действие
// (OWNER, GRANT, REQUEST, APPLICATION, PLATFORM, SYSTEM, STAFF), а лишняя или чужая пометка
// перекрасила бы событие в другой путь.
//
// Свой поток случайностей (как у библиотеки в index.mjs): число вызовов здесь не должно
// сдвигать данные следующих шагов вуза.

import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'
import { child, id } from '../lib/ids.mjs'
import { makeRandom, SEED_BASE } from '../lib/rng.mjs'

const HOUR = 3_600_000
const DOCUMENT_SCAN_MIMES = ['application/pdf', 'image/jpeg', 'image/png']
const PLATFORM_REASON = 'Проверка по обращению в поддержку'

// Платформенный админ — один на прогон: вузы идут параллельно, а запрос нужен один.
let platformActorPromise = null
function platformActor(prisma) {
  platformActorPromise ??= prisma.user
    .findFirst({
      where: { role: { in: ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    .then((u) => u?.id ?? null)
  return platformActorPromise
}

export async function seedDocumentJournal(prisma, writer, ctx) {
  const { index, structure, people, pool, allStudents } = ctx
  const { uniId } = structure
  const random = makeRandom(SEED_BASE + index * 7919 + 72)
  const nextScan = formatCycler(formatSamples(pool?.formats, 'documents', { mimes: DOCUMENT_SCAN_MIMES })) // prettier-ignore
  const faculty = people.faculties[0]
  const teacherId = faculty.teacherIds[0]
  const page0 = (documentId) => child(documentId, 'p', 0)
  // Снятая страница: строку File API удаляет сразу (purgePage), в журнале остаётся её id.
  const gonePage = (documentId, n) => child(documentId, 'p', 'gone', n)
  const doc = (studentId, type) => child(studentId, 'doc', type)

  // id события — от документа и имени сценария: число строк сценария зависит от наличия
  // хранилища, и сквозной счётчик дал бы разным прогонам разные id одних и тех же событий.
  const event = (key, documentId, actorId, action, metadata, createdAt, extra = {}) =>
    writer.add('documentEvent', {
      id: child(documentId ?? extra.requestId, 'jev', key),
      documentId,
      actorId,
      action,
      ...(metadata ? { metadata } : {}),
      createdAt,
      ...extra,
    })
  const since = (days) => random.randomDate(-days, -1)

  // Сценарии — по студенту на сценарий. ID_CARD и PASSPORT есть у каждого (шаг 70 создаёт
  // минимум пять первых типов), STUDY_PLACE — тоже.
  const [s0, s1, s2, s3, s4, s5] = allStudents
  const files = []
  const deleted = []

  // 1. Грант пользователю (преподаватель) и его просмотр и скачивание — путь GRANT.
  if (s0) {
    const documentId = doc(s0, 'PASSPORT')
    const accessId = child(documentId, 'acc', 'user')
    const grantedAt = since(40)
    await writer.add('documentAccess', {
      id: accessId,
      documentId,
      granteeType: 'USER',
      granteeId: teacherId,
      reason: 'проверка данных для научной стажировки',
      grantedById: s0,
      grantedAt,
      expiresAt: random.daysFromNow(60),
    })
    await event('grant', documentId, s0, 'GRANT', { granteeType: 'USER' }, grantedAt)
    const meta = { fileId: page0(documentId), accessId, granteeType: 'USER' }
    await event(
      'view',
      documentId,
      teacherId,
      'VIEW',
      meta,
      new Date(grantedAt.getTime() + 2 * HOUR),
    )
    await event(
      'download',
      documentId,
      teacherId,
      'DOWNLOAD',
      meta,
      new Date(grantedAt.getTime() + 3 * HOUR),
    )
  }

  // 2. Грант факультету: декан смотрит, владелец отзывает — GRANT и REVOKE.
  if (s1) {
    const documentId = doc(s1, 'ID_CARD')
    const accessId = child(documentId, 'acc', 'dep')
    const grantedAt = since(60)
    const revokedAt = new Date(grantedAt.getTime() + 5 * 24 * HOUR)
    await writer.add('documentAccess', {
      id: accessId,
      documentId,
      granteeType: 'DEPARTMENT',
      granteeId: faculty.id,
      reason: 'оформление общежития',
      grantedById: s1,
      grantedAt,
      revokedAt,
    })
    await event('grant', documentId, s1, 'GRANT', { granteeType: 'DEPARTMENT' }, grantedAt)
    await event('view', documentId, faculty.deanId, 'VIEW', { fileId: page0(documentId), accessId, granteeType: 'DEPARTMENT' }, new Date(grantedAt.getTime() + HOUR)) // prettier-ignore
    await event('revoke', documentId, s1, 'REVOKE', { granteeType: 'DEPARTMENT' }, revokedAt)
  }

  // 3. Владелец: просмотр своего скана, правка данных и порядок страниц — путь OWNER.
  if (s2) {
    const passport = doc(s2, 'PASSPORT')
    const idCard = doc(s2, 'ID_CARD')
    await event('view', passport, s2, 'VIEW', { fileId: page0(passport) }, since(30))
    await event('edit', passport, s2, 'EDIT', null, since(20))
    await event('reorder', idCard, s2, 'EDIT', { reordered: true }, since(15))
  }

  // 4. Страницы: замена скана, дозагрузка и снятие лишней страницы.
  if (s3) {
    const idCard = doc(s3, 'ID_CARD')
    const passport = doc(s3, 'PASSPORT')
    const at = since(25)
    await event('replace', idCard, s3, 'REPLACE', { fileId: page0(idCard), replacedFileId: gonePage(idCard, 0), order: 0 }, at) // prettier-ignore
    // Дописанная к паспорту страница — настоящая строка File (вторая страница документа).
    const sample = nextScan()
    if (sample) {
      files.push(
        formatFileRow(sample, 1, {
          id: child(passport, 'p', 1),
          ownerId: s3,
          documentId: passport,
          order: 1,
          createdAt: at,
        }),
      )
      await event('page-add', passport, s3, 'PAGE_ADD', { added: 1 }, at)
    }
    // Лишний третий скан удостоверения: добавлен и снят — в документе по-прежнему две стороны.
    const extraAt = new Date(at.getTime() + HOUR)
    await event('page-add', idCard, s3, 'PAGE_ADD', { added: 1 }, extraAt)
    await event('page-remove', idCard, s3, 'PAGE_REMOVE', { fileId: gonePage(idCard, 2), order: 2 }, new Date(extraAt.getTime() + 10 * 60_000)) // prettier-ignore
  }

  // 5. Удалённый документ: мягкое удаление, журнал остаётся (DELETE), скан ждёт уборки.
  if (s4) {
    const documentId = doc(s4, 'PHOTO_3X4')
    const createdAt = since(90)
    deleted.push({ documentId, ownerId: s4, createdAt })
    await writer.add('document', {
      id: documentId,
      ownerId: s4,
      universityId: uniId,
      category: 'PERSONAL',
      type: 'PHOTO_3X4',
      title: 'Фото 3×4',
      status: 'UPLOADED',
      deletedAt: new Date(createdAt.getTime() + 7 * 24 * HOUR),
      createdAt,
    })
    const sample = nextScan()
    if (sample) {
      files.push(
        formatFileRow(sample, 4, {
          id: page0(documentId),
          ownerId: s4,
          documentId,
          order: 0,
          createdAt,
        }),
      )
    }
  }

  // 6. Архив и возврат из него: прежний статус в событии, возврат его восстанавливает.
  if (s5) {
    const documentId = doc(s5, 'STUDY_PLACE')
    const at = since(50)
    await event(
      'archive',
      documentId,
      s5,
      'ARCHIVE',
      { archived: true, previousStatus: 'UPLOADED' },
      at,
    )
    await event('unarchive', documentId, s5, 'UNARCHIVE', { status: 'UPLOADED' }, new Date(at.getTime() + 3 * 24 * HOUR)) // prettier-ignore
  }
  // Документ и страницы — в базу раньше событий о них: поток `file` у writer'а стоит раньше
  // `document` (его открыли шаги академики), а события ссылаются на документ.
  await writer.flush()
  await writer.addMany('file', files)
  for (const { documentId, ownerId, createdAt } of deleted) {
    await event('upload', documentId, ownerId, 'UPLOAD', { added: 1 }, createdAt)
    await event('delete', documentId, ownerId, 'DELETE', null, new Date(createdAt.getTime() + 7 * 24 * HOUR)) // prettier-ignore
  }

  // 7. Спец-режим платформы: метаданные и сканы чужого документа — только с причиной, плюс
  // запись в аудите (DOCUMENT_PLATFORM_VIEW/DOWNLOAD). Журнал прячет имя — путь PLATFORM.
  const platformId = await platformActor(prisma)
  if (platformId && s0) {
    const documentId = doc(s0, 'ID_CARD')
    const viewAt = since(12)
    const fileIds = [page0(documentId), child(documentId, 'p', 1)]
    await event('platform-meta', documentId, platformId, 'VIEW', { platformMode: true, meta: true, reason: PLATFORM_REASON }, viewAt) // prettier-ignore
    await event('platform-files', documentId, platformId, 'VIEW', { platformMode: true, fileIds, reason: PLATFORM_REASON }, new Date(viewAt.getTime() + 60_000)) // prettier-ignore
    await writer.add('auditLog', {
      id: id(index, 'audit', 'doc-platform-view'),
      userId: platformId,
      action: 'DOCUMENT_PLATFORM_VIEW',
      entity: 'Document',
      entityId: documentId,
      metadata: { reason: PLATFORM_REASON },
      createdAt: viewAt,
    })
    await writer.add('auditLog', {
      id: id(index, 'audit', 'doc-platform-download'),
      userId: platformId,
      action: 'DOCUMENT_PLATFORM_DOWNLOAD',
      entity: 'Document',
      entityId: documentId,
      metadata: { fileIds, reason: PLATFORM_REASON },
      createdAt: new Date(viewAt.getTime() + 60_000),
    })
  }

  // 8. Сотрудник открывает скан из заявки — путь APPLICATION (viaApplication).
  const attached = await prisma.applicationDocument.findMany({
    where: { application: { universityId: uniId, status: { not: 'DRAFT' } } },
    select: {
      id: true,
      applicationId: true,
      documentId: true,
      application: { select: { assignedToId: true, facultyId: true } },
    },
    orderBy: { id: 'asc' },
    take: 2,
  })
  for (const ad of attached) {
    if (!ad.documentId) continue
    const viewer =
      ad.application.assignedToId ??
      people.faculties.find((f) => f.id === ad.application.facultyId)?.deanId ??
      people.adminId
    await event(`app-${ad.id}`, ad.documentId, viewer, 'VIEW', { fileId: page0(ad.documentId), viaApplication: ad.applicationId, applicationDocumentId: ad.id }, since(5)) // prettier-ignore
  }

  // 9. Проверяющий открывает скан в комплекте запроса — путь REQUEST (viaSubmission).
  if (s0) {
    const documentId = doc(s0, 'ID_CARD')
    await event('submission-view', documentId, faculty.deanId, 'VIEW', { fileId: page0(documentId), viaSubmission: child(child(s0, 'docsub'), 'it', 0) }, since(6), { requestId: id(index, 'docreq') }) // prettier-ignore
  }

  await writer.flush()
}
