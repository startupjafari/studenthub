import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PinoLogger } from 'nestjs-pino'
import { scrubUrl } from '@studenthub/shared-config'
import { clientVersionFrom } from './client-version'

/**
 * Поля строки access-лога: requestId, метод, путь, РЕАЛЬНЫЙ статус ответа и длительность.
 *
 * clientVersion добавляется, только когда клиент его прислал (мобильное приложение,
 * план iOS Задача Б3): у веба заголовка нет, и пустое поле в каждой строке лога
 * только мешало бы читать.
 */
export function accessLogEntry(
  request: FastifyRequest,
  reply: FastifyReply,
): { fields: Record<string, unknown>; message: string } {
  // Секреты из адреса не пишем (§13): токен инвайта стоит прямо в пути
  // (`/invites/:token/preview`), а `?token=` / `?code=` / `?t=` — в query. Сырой URL в логе
  // означал бы, что регистрироваться по чужому неиспользованному инвайту может любой,
  // у кого есть доступ к логам.
  const path = scrubUrl(request.url)
  const { method } = request
  const { statusCode } = reply
  const clientVersion = clientVersionFrom(request)
  return {
    fields: {
      requestId: request.id,
      method,
      path,
      statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...(clientVersion ? { clientVersion } : {}),
    },
    message: `${method} ${path} ${statusCode}`,
  }
}

/**
 * Строка на каждый HTTP-запрос — по хуку Fastify `onResponse` (§13), а не перехватчиком
 * Nest. Перехватчик работает только вокруг обработчика: отказы guard'ов (401/403/429/503)
 * до него не доходили — перебор входа в логе не был виден, — а статус он угадывал по
 * исключению (422 Zod писался как 400, P2002 как 500, 201/204 как 200). `onResponse`
 * срабатывает, когда ответ уже отправлен, и видит ровно тот статус, что получил клиент.
 */
export function registerAccessLog(fastify: FastifyInstance, logger: PinoLogger): void {
  fastify.addHook('onResponse', (request, reply, done) => {
    const { fields, message } = accessLogEntry(request, reply)
    logger.info(fields, message)
    done()
  })
}
