// Идемпотентный seed (docs/PROJECT.md §14): PLATFORM_ADMIN, демо-вуз/факультет/группа/
// аудитории (Фаза 5) и dev-инвайт для UNIVERSITY_ADMIN на этот вуз.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Dev-инвайт: фиксированный токен, срок 30 дней (dev-only, резолюция §19.2). В проде отзывается после первого использования.
const DEV_INVITE_TOKEN = 'seed-invite-university-admin-token'
const SEED_UNIVERSITY_ID = 'seed-university-001'

async function main() {
  const passwordHash = await bcrypt.hash('Admin1234!', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@studenthub.app' },
    update: {}, // не перезаписываем пароль/профиль при повторном запуске
    create: {
      email: 'admin@studenthub.app',
      passwordHash,
      firstName: 'Платформенный',
      lastName: 'Администратор',
      role: 'PLATFORM_ADMIN',
    },
  })

  // Демо-структура (Фаза 5): вуз ACTIVE, факультет, группа, 3 аудитории.
  const university = await prisma.university.upsert({
    where: { id: SEED_UNIVERSITY_ID },
    update: {},
    create: {
      id: SEED_UNIVERSITY_ID,
      name: 'Демонстрационный университет',
      shortName: 'ДемоВУЗ',
      status: 'ACTIVE',
      country: 'Казахстан',
      city: 'Алматы',
    },
  })

  const faculty = await prisma.faculty.upsert({
    where: { id: 'seed-faculty-001' },
    update: {},
    create: {
      id: 'seed-faculty-001',
      name: 'Факультет информационных технологий',
      universityId: university.id,
    },
  })

  await prisma.group.upsert({
    where: { id: 'seed-group-001' },
    update: {},
    create: { id: 'seed-group-001', name: 'ИТ-23-1', year: 2023, facultyId: faculty.id },
  })

  const rooms = [
    ['seed-room-101', '101', 30],
    ['seed-room-102', '102', 50],
    ['seed-room-103', 'Лаборатория A', 20],
  ]
  for (const [id, name, capacity] of rooms) {
    await prisma.room.upsert({
      where: { id },
      update: {},
      create: { id, name, capacity, universityId: university.id },
    })
  }

  await prisma.invite.upsert({
    where: { token: DEV_INVITE_TOKEN },
    update: {},
    create: {
      token: DEV_INVITE_TOKEN,
      role: 'UNIVERSITY_ADMIN',
      email: 'university-admin@demo.studenthub.app',
      universityId: SEED_UNIVERSITY_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      createdById: admin.id,
    },
  })

  // Dev-пользователи по всем ролям (кроме PLATFORM_ADMIN — он выше). Все с паролем
  // Admin1234!, привязаны к демо-скоупу. Идемпотентно (upsert по email, update:{} —
  // повторный запуск не трогает пароль/профиль). Только для dev/демо — в проде сменить/удалить.
  const scope = {
    university: { universityId: SEED_UNIVERSITY_ID },
    faculty: { universityId: SEED_UNIVERSITY_ID, facultyId: faculty.id },
    group: { universityId: SEED_UNIVERSITY_ID, facultyId: faculty.id, groupId: 'seed-group-001' },
  }
  // Реалистичные имена: роль показывается отдельным бейджем, поэтому имя-плейсхолдер
  // из слов роли («Декан Факультета») читалось некорректно в любом порядке — заменено.
  const devUsers = [
    ['PLATFORM_MODERATOR', 'platform-moderator@studenthub.app', 'Марат', 'Сулейменов', {}],
    [
      'UNIVERSITY_ADMIN',
      'university-admin@studenthub.app',
      'Айгуль',
      'Нурланова',
      scope.university,
    ],
    ['UNIVERSITY_MODERATOR', 'university-moderator@studenthub.app', 'Тимур', 'Байжанов', scope.university], // prettier-ignore
    ['DEAN', 'dean@studenthub.app', 'Дамир', 'Ахметов', scope.faculty],
    ['TEACHER', 'teacher@studenthub.app', 'Елена', 'Иванова', scope.faculty],
    ['STAROSTA', 'starosta@studenthub.app', 'Аружан', 'Серикова', scope.group],
    ['STUDENT', 'student@studenthub.app', 'Нурлан', 'Оспанов', scope.group],
  ]
  for (const [role, email, firstName, lastName, userScope] of devUsers) {
    await prisma.user.upsert({
      where: { email },
      // Синхронизируем имя на существующих dev-аккаунтах (иначе старые плейсхолдеры остаются).
      update: { firstName, lastName },
      create: { email, passwordHash, firstName, lastName, role, ...userScope },
    })
  }

  console.log('Seed готов:')
  console.log('  PLATFORM_ADMIN: admin@studenthub.app / Admin1234!  (сменить сразу)')
  console.log('  Пользователи по ролям (пароль у всех Admin1234!):')
  for (const [role, email] of devUsers) {
    console.log(`    ${role}: ${email}`)
  }
  console.log(
    '  Демо-вуз: Демонстрационный университет (ACTIVE) + факультет ИТ + группа ИТ-23-1 + 3 аудитории',
  )
  console.log(`  dev-инвайт UNIVERSITY_ADMIN: /register?token=${DEV_INVITE_TOKEN}`)
}

main()
  .catch((error) => {
    console.error('Seed упал:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
