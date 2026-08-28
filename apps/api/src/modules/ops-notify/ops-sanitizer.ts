// Санитайзер служебных сообщений (docs/TELEGRAM_BOT.md §7.2.2).
//
// Вызывается внутри TelegramOpsService — то есть стоит на единственном пути наружу.
// Смысл именно в этом: реестр и билдер уже устроены так, что ПД в сообщение не попадают,
// но «уже устроены» — это про сегодняшний код. Санитайзер страхует завтрашний: даже если
// кто-то передаст в данные события email пользователя или кусок токена, в чат оно не уедет.
//
// Правила намеренно грубые. Ложное срабатывание стоит одной нечитаемой строки в служебном
// канале; пропуск — утечки персональных данных или секрета в мессенджер.

/** Telegram режет сообщение на 4096 символах; берём с запасом под пометку об обрезке. */
const MAX_LENGTH = 3500

const REDACTED = '«скрыто»'

const RULES: readonly { pattern: RegExp; replace: string }[] = [
  // Email — самая вероятная утечка: он есть почти в каждом payload'е вебхуков.
  { pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replace: REDACTED },
  // Телефон в казахстанском/российском формате. Шаблон намеренно узкий (требует кода
  // страны 7/8): широкий съедал бы даты и короткие SHA, а они в служебном канале нужны.
  { pattern: /\+?[78][\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, replace: REDACTED },
  // JWT: три base64url-сегмента через точку.
  { pattern: /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, replace: REDACTED },
  // Токен бота BotFather: `123456789:AA...`.
  { pattern: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, replace: REDACTED },
  // `Bearer <токен>`: отдельным правилом, потому что общему `ключ: значение` достался бы
  // только сам «Bearer», а токен стоит за пробелом.
  { pattern: /\bbearer\s+\S+/gi, replace: REDACTED },
  // `token=...`, `secret: ...`, `api-key: ...` в любом регистре.
  {
    pattern: /\b(token|secret|password|passwordHash|api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi,
    replace: `$1: ${REDACTED}`,
  },
  // Секрет в query-строке ссылки: саму ссылку сохраняем, хвост срезаем.
  {
    pattern: /(https?:\/\/\S*?)[?&](?:token|secret|key|signature|sig)=[^\s&]+/gi,
    replace: '$1',
  },
  // Длинная случайная строка — почти всегда ключ. Полный git SHA (40 символов) не трогаем.
  { pattern: /\b[A-Za-z0-9_-]{60,}\b/g, replace: REDACTED },
]

// Управляющие символы ломают разметку сообщения. Перевод строки и табуляцию оставляем.
// no-control-regex отключён осознанно: правило ловит управляющие символы, попавшие в
// регулярное выражение по недосмотру, а здесь они — единственный смысл выражения.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/**
 * Вырезает персональные данные и секреты, схлопывает управляющие символы и обрезает длину.
 * Чистая функция: тестируется без Nest и без сети.
 */
export function sanitizeOpsText(text: string): string {
  let out = text
  for (const { pattern, replace } of RULES) {
    out = out.replace(pattern, replace)
  }
  out = out.replace(CONTROL_CHARS, ' ')
  if (out.length > MAX_LENGTH) {
    out = `${out.slice(0, MAX_LENGTH)}…`
  }
  return out
}
