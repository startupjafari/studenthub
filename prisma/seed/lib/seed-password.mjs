// Пароль демо-аккаунтов сида.
//
// Раньше он был константой `Admin1234!` прямо в seed.mjs — а сид это и есть штатный
// путь бутстрапа прода (workflow «Seed (Railway)»). То есть у платформенного админа на
// живом стенде был пароль, опубликованный в репозитории. Форс 2FA от этого не спасает:
// при выключенной 2FA вход отдаёт полноценную сессию, а TwoFactorGuard пропускает
// эндпоинты @TwoFactorExempt() — то есть настройку 2FA. Кто войдёт первым, тот и
// привяжет свой аутентификатор.
//
// Поведение:
//   • SEED_PASSWORD задан — берём его (и локально, и в проде);
//   • не задан, но сид идёт в удалённую базу (SEED_ALLOW_REMOTE=1) или NODE_ENV=production
//     — генерируем случайный и печатаем ОДИН раз;
//   • не задан локально — прежний `Admin1234!`, чтобы вход из документации продолжал
//     работать без лишних телодвижений.
//
// Условие именно такое: опасен не «прод» как метка окружения, а прогон против базы,
// до которой дотянется кто-то кроме разработчика. Ровно этот прогон и разрешается
// флагом SEED_ALLOW_REMOTE (гард в seed/config.mjs).

import { randomBytes } from 'node:crypto'

/** Пароль по умолчанию для локальной разработки. В проде не используется. */
export const DEV_PASSWORD = 'Admin1234!'

/** Случайный пароль: 24 символа base64url — заведомо переживает политику (§3). */
function generatePassword() {
  // Спецсимвол добавляем явно: base64url его не содержит, а PasswordSchema требует.
  return `${randomBytes(18).toString('base64url')}!`
}

/**
 * Разрешает пароль сид-аккаунтов и сообщает, показывать ли его в итоговой сводке.
 *
 * @returns {{ password: string, generated: boolean, fromEnv: boolean }}
 */
export function resolveSeedPassword() {
  const fromEnv = process.env.SEED_PASSWORD?.trim()
  if (fromEnv) {
    return { password: fromEnv, generated: false, fromEnv: true }
  }
  const remote = process.env.SEED_ALLOW_REMOTE === '1'
  if (remote || process.env.NODE_ENV === 'production') {
    return { password: generatePassword(), generated: true, fromEnv: false }
  }
  return { password: DEV_PASSWORD, generated: false, fromEnv: false }
}

/**
 * Печатает пароль так, чтобы его нельзя было не заметить.
 *
 * Сгенерированный пароль существует ровно в этом выводе: в базе лежит только bcrypt-хэш,
 * восстановить его будет неоткуда. Отдельная рамка — чтобы он не потерялся в сотне строк
 * прогресса сида.
 */
export function reportSeedPassword({ password, generated, fromEnv }) {
  if (generated) {
    console.log('')
    console.log('  ┌─────────────────────────────────────────────────────────────┐')
    console.log('  │ SEED_PASSWORD не задан, а сид идёт в удалённую базу.         │')
    console.log('  │ Пароль сид-аккаунтов сгенерирован и больше нигде не хранится:│')
    console.log(`  │   ${password.padEnd(58)}│`)
    console.log('  │ Сохраните его сейчас и смените после первого входа.          │')
    console.log('  └─────────────────────────────────────────────────────────────┘')
    console.log('')
    return
  }
  if (fromEnv) {
    console.log('  Пароль сид-аккаунтов: из SEED_PASSWORD (в выводе не печатается)')
    return
  }
  console.log(`  Пароль сид-аккаунтов: ${password}  (dev-умолчание, сменить в проде)`)
}
