// Разовая выдача двух учёток для проверки чатов на Railway (по просьбе владельца 15.11.2026).
// Два студента одной группы вуза u001: пароль — тот же, что у admin@studenthub.app (Admin1234!),
// здесь только его bcrypt-хэш, чтобы пароль не попал в лог прогона. Снимаются блокировка и 2FA.
//
//   node prisma/chat-test-accounts.mjs   (DATABASE_URL из окружения)
import { appendFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// bcrypt (cost 12) от Admin1234!, сверен compare === true.
const HASH = '$2b$12$UZEb8U1W.RW0gc1HtvBhouj95DuETpb.JLRjTcCAspPcposH1uaay'

const prisma = new PrismaClient()

async function main() {
  const [group] = await prisma.$queryRawUnsafe(`
    SELECT group_id AS "groupId" FROM users
    WHERE role = 'STUDENT' AND deleted_at IS NULL AND group_id IS NOT NULL
      AND email LIKE '%@u001.edu.kz'
    GROUP BY group_id HAVING count(*) >= 2
    ORDER BY min(email) LIMIT 1`)
  if (!group) throw new Error('Нет группы u001 с двумя студентами')

  const users = await prisma.$queryRawUnsafe(
    `SELECT id, email, first_name AS "firstName", last_name AS "lastName" FROM users
     WHERE role = 'STUDENT' AND deleted_at IS NULL AND group_id = $1
     ORDER BY email LIMIT 2`,
    group.groupId,
  )
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE users SET password_hash = $1, is_blocked = false, blocked_until = NULL,
       two_factor_enabled = false, two_factor_secret = NULL, two_factor_backup_codes = '{}'
     WHERE id = ANY($2::text[])`,
    HASH,
    users.map((u) => u.id),
  )

  const lines = [
    '## Учётки для проверки чатов',
    '',
    `Обновлено: ${updated}. Пароль — как у admin@studenthub.app.`,
    '',
    ...users.map((u) => `- ${u.email} — ${u.lastName} ${u.firstName}`),
    '',
  ].join('\n')
  console.log(lines)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
