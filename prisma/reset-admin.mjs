// Одноразовый ремонт входа + ДИАГНОСТИКА. Печатает, к какой БД реально подключился
// процесс (хост+имя БД, без пароля) и её состояние, затем принудительно ставит пароль
// PLATFORM_ADMIN (в отличие от seed с upsert update:{}). Запускается через seed-workflow
// ветки fix/admin-login-reset (у GitHub-раннера есть egress до публичного PG-proxy).
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const EMAIL = 'admin@studenthub.app'
const PASSWORD = 'Admin1234!'

// Куда подключились (без пароля) — сверить с DATABASE_URL сервиса API.
// Парсим строкой, без глобала URL (его нет в eslint-globals для prisma/*.mjs).
const dbUrl = process.env.DATABASE_URL ?? ''
const m = dbUrl.match(/@([^/]+)\/([^?]+)/) // [1]=host:port, [2]=dbname
const target = m ? `${m[1]}/${m[2]}` : '(unknown)'

const prisma = new PrismaClient()

const totalBefore = await prisma.user.count()
const emails = (
  await prisma.user.findMany({ select: { email: true }, orderBy: { createdAt: 'desc' }, take: 10 })
).map((u) => u.email)
const existing = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
const passwordHash = await bcrypt.hash(PASSWORD, 12)

const admin = await prisma.user.upsert({
  where: { email: EMAIL },
  update: { passwordHash, isBlocked: false, deletedAt: null },
  create: {
    email: EMAIL,
    passwordHash,
    firstName: 'Платформенный',
    lastName: 'Администратор',
    role: 'PLATFORM_ADMIN',
  },
})

console.log(
  JSON.stringify(
    {
      connected_db: target,
      db_total_users_before: totalBefore,
      sample_emails: emails,
      admin_existed_before: Boolean(existing),
      action: existing ? 'password-reset' : 'created',
      admin_id: admin.id,
      login: `${EMAIL} / ${PASSWORD}`,
    },
    null,
    2,
  ),
)

await prisma.$disconnect()
