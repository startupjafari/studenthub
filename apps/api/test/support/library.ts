import { randomBytes } from 'node:crypto'
import request from 'supertest'
import type { PrismaService } from '../../src/common/prisma/prisma.service'
import { bearer, type E2eApp } from './e2e-app'

// Фабрики библиотеки для e2e: вуз с включённой библиотекой, книга с экземплярами и сессия
// выдачи по скану студенческого — так, как её получает библиотекарь у стойки.

/** Таблицы, которые трогают спеки библиотеки; `CASCADE` добирает зависимые. */
export const LIBRARY_TABLES =
  'library_id_access_logs, reservations, loans, book_copies, books, library_settings, document_exports, notifications, audit_logs, refresh_tokens, groups, faculties, universities, users'

export async function resetLibrary(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${LIBRARY_TABLES} RESTART IDENTITY CASCADE`)
}

/** Вуз с включённой библиотекой и правилами по умолчанию (`LibrarySettings`). */
export async function makeLibraryUniversity(
  prisma: PrismaService,
  id: string,
  name = 'Библиотечный вуз',
): Promise<void> {
  await prisma.university.create({ data: { id, name } })
  await prisma.librarySettings.create({ data: { universityId: id, enabled: true } })
}

/** Книга вуза и её экземпляры с указанными инвентарными номерами, все на полке. */
export async function makeBook(
  prisma: PrismaService,
  universityId: string,
  title: string,
  inventoryNumbers: string[],
): Promise<{ bookId: string; copyIds: string[] }> {
  const book = await prisma.book.create({ data: { universityId, title }, select: { id: true } })
  const copyIds: string[] = []
  for (const inventoryNumber of inventoryNumbers) {
    const copy = await prisma.bookCopy.create({
      data: {
        bookId: book.id,
        universityId,
        inventoryNumber,
        code: randomBytes(4).toString('hex').toUpperCase(),
      },
      select: { id: true },
    })
    copyIds.push(copy.id)
  }
  return { bookId: book.id, copyIds }
}

/**
 * Сессия выдачи по скану QR: студент открывает свой студенческий (`GET /student-id/me`),
 * библиотекарь сканирует код (`POST /library/readers/resolve`). Возвращает тело сессии —
 * пропуск (`ticket`), карточку и `eligibility`.
 */
export async function scanReader(
  e2e: Pick<E2eApp, 'server'>,
  librarianToken: string,
  studentToken: string,
): Promise<{
  ticket: string
  via: string
  eligibility: { canBorrow: boolean; blockers: string[] }
  reader: { id: string }
}> {
  const card = await request(e2e.server)
    .get('/api/v1/student-id/me')
    .set(bearer(studentToken))
    .expect(200)
  const session = await request(e2e.server)
    .post('/api/v1/library/readers/resolve')
    .set(bearer(librarianToken))
    .send({ token: card.body.data.token })
    .expect(201)
  return session.body.data
}
