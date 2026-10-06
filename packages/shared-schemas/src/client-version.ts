import { z } from 'zod'

// Поддерживаемая версия мобильного клиента (план iOS, Задача Б3).
//
// Зачем это вообще нужно. Нативное приложение обновляет не сервер, а человек, и часть
// людей не обновляет его никогда. Сборка, которая старше контракта API, ведёт себя
// хуже, чем отсутствие приложения: экраны пустые, ошибки непонятные, а жалоба
// приходит на платформу. Поэтому у клиента должен быть способ спросить, работает он
// ещё или пора обновиться.

// Платформы, у которых есть собственная сборка. Android появится — добавится сюда,
// и клиент его увидит без правки контракта.
export const ClientPlatformSchema = z.enum(['ios'])
export type ClientPlatform = z.infer<typeof ClientPlatformSchema>

// Запрос: платформа обязательна. Версию сборки клиент присылает заголовком
// `X-Client-Version` — в запросе её нет намеренно, чтобы ответ можно было кэшировать
// и чтобы сервер не решал за клиента, что ему делать.
export const ClientVersionQuerySchema = z.object({ platform: ClientPlatformSchema }).strict()
export type ClientVersionQuery = z.infer<typeof ClientVersionQuerySchema>

// Ответ: минимальная версия, ниже которой приложение работать не должно, и адрес
// магазина для кнопки «Обновить». Сравнение версий делает клиент: он всё равно
// обязан уметь жить без сети и помнить последний ответ.
export const ClientVersionSchema = z.object({
  platform: ClientPlatformSchema,
  minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  storeUrl: z.string().url().optional(),
})
export type ClientVersionInfo = z.infer<typeof ClientVersionSchema>
