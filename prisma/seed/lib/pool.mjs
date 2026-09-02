// Ограниченный параллелизм: N задач одновременно.
//
// Зачем: вузы независимы друг от друга (свой PRNG, свои id), поэтому их можно
// генерировать параллельно — на локальном Postgres это кратно быстрее, чем по одному:
// пока один воркер строит строки в JS, другой ждёт ответа от БД.
//
// Почему не Promise.all по всем 100: столько параллельных createMany выжрут пул
// соединений Prisma (по умолчанию невелик) и получат таймауты на пустом месте.
// Значение по умолчанию — SEED_CONCURRENCY=4.

export async function runPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0
  const errors = []

  async function drain() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        await worker(items[index], index)
      } catch (error) {
        // Один упавший вуз не должен обрывать остальные 99: собираем ошибки и
        // бросаем их в конце, уже залитые вузы останутся помеченными маркером.
        errors.push({ item: items[index], error })
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, drain))

  if (errors.length > 0) {
    const details = errors
      .slice(0, 5)
      .map(({ item, error }) => `  · ${JSON.stringify(item)}: ${error.message}`)
      .join('\n')
    throw new Error(`Не удалось сгенерировать ${errors.length} элем.:\n${details}`)
  }
}
