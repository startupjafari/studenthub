// Буферная пакетная запись строк.
//
// Зачем: старый сид складывал все строки домена в массив и вставлял его в конце
// (`attRows`, `gradeRows`). На демо-объёме это нормально, на 100 вузах посещаемость —
// это ~4 млн объектов в heap одновременно, то есть несколько гигабайт и OOM.
// Writer держит в памяти максимум chunkSize строк на модель: как только буфер полон,
// он уходит в createMany и очищается.
//
// Идемпотентность: skipDuplicates: true + детерминированные id в строках. Повторный
// прогон не создаёт дубликатов и не падает на уникальных индексах.

export function createWriter(prisma, { chunkSize = 2000, onFlush } = {}) {
  // model -> { delegate, buffer }
  const streams = new Map()
  const counts = {}
  let written = 0

  function stream(model) {
    let entry = streams.get(model)
    if (!entry) {
      const delegate = prisma[model]
      if (!delegate?.createMany) {
        throw new Error(`Модель "${model}" не найдена в Prisma Client (опечатка в имени?)`)
      }
      entry = { delegate, buffer: [] }
      streams.set(model, entry)
    }
    return entry
  }

  async function flushStream(model, entry) {
    if (entry.buffer.length === 0) return
    const rows = entry.buffer
    entry.buffer = []
    try {
      await entry.delegate.createMany({ data: rows, skipDuplicates: true })
    } catch (error) {
      // Без этого контекста ошибка Prisma («Foreign key constraint violated») не
      // говорит, какая именно модель упала, — а в сиде их восемьдесят.
      error.message = `createMany(${model}) на ${rows.length} строк: ${error.message}`
      throw error
    }
    counts[model] = (counts[model] ?? 0) + rows.length
    written += rows.length
    onFlush?.(model, rows.length, written)
  }

  // Флаш переполненного буфера вместе со всем, что было добавлено ДО него.
  //
  // Зачем: буферы наполняются с разной скоростью. `grade` набирает свои 2000 строк,
  // когда `gradeColumn` (родитель по внешнему ключу) ещё лежит в буфере с двумя
  // десятками строк, — и вставка оценок падает на grades_column_id_fkey.
  //
  // Порядок вставки в Map — это порядок первого обращения к модели в коде шага, а шаги
  // всегда создают родителя раньше ребёнка (иначе внешний ключ не сошёлся бы и при
  // одном общем flush). Значит, «всё до X включительно» — корректный порядок записи.
  // Уже пустые буферы пропускаются, так что повторные флаши тяжёлой модели почти
  // не платят за соседей.
  async function flushUpTo(model) {
    for (const [name, entry] of streams) {
      if (entry.buffer.length > 0) await flushStream(name, entry)
      if (name === model) break
    }
  }

  return {
    // Добавить строку. Возвращает промис только когда буфер переполнился, поэтому
    // вызывающий код всегда должен await'ить: `await w.add('grade', row)`.
    async add(model, row) {
      const entry = stream(model)
      entry.buffer.push(row)
      if (entry.buffer.length >= chunkSize) await flushUpTo(model)
    },

    async addMany(model, rows) {
      for (const row of rows) await this.add(model, row)
    },

    // Дописать все буферы. Обязателен перед чтением зависимых данных и в конце шага:
    // строки в буфере в БД ещё не существуют, и FK на них не проверятся.
    async flush() {
      for (const [model, entry] of streams) await flushStream(model, entry)
    },

    counts,
    get written() {
      return written
    },
  }
}
