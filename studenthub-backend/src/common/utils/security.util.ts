import * as crypto from 'crypto';

/**
 * Сравнение строк за постоянное время для предотвращения timing-атак
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Хеширование email для логов (показывает только первые 3 символа)
 */
export function hashEmailForLogging(email: string): string {
  if (!email || email.length < 3) {
    return '***';
  }

  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return '***';
  }

  const visiblePart = localPart.substring(0, 3);
  const hash = crypto
    .createHash('sha256')
    .update(email)
    .digest('hex')
    .substring(0, 8);

  return `${visiblePart}***@${domain} (hash: ${hash})`;
}

/**
 * Санитизация email для логов (альтернатива: показывать только первые 3 символа)
 */
export function sanitizeEmailForLogging(email: string): string {
  if (!email || email.length < 3) {
    return '***';
  }

  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return '***';
  }

  if (localPart.length <= 3) {
    return `${localPart[0]}***@${domain}`;
  }

  return `${localPart.substring(0, 3)}***@${domain}`;
}
