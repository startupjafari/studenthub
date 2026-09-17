import type { ThrottlerStorage } from '@nestjs/throttler'

/**
 * Хранилище счётчиков rate limit для e2e: ничего не считает и никуда не ходит.
 *
 * Зачем подменять, если `ThrottlerGuard` и так переопределён: guard'ов у throttler'а
 * несколько (свой лимит у вебхуков ops, у логина), и часть запросов всё равно доходит до
 * хранилища. Раньше тесты вместо подмены чистили внутреннюю `Map` штатного хранилища между
 * тестами — с переездом счётчиков в Redis (`ResilientThrottlerStorage`) этой `Map` не стало,
 * и все спеки с таким сбросом падали на `Cannot read properties of undefined (reading 'clear')`.
 *
 * Заглушка вместо чистки живого Redis выбрана сознательно: e2e не должен зависеть от
 * состояния соседнего прогона, а лимиты проверяются юнит-тестами самого хранилища.
 */
export const throttlerStorageStub: ThrottlerStorage = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
}
