import { apiGetPaged } from './client'

// Числа на вкладках. Считаются самыми дешёвыми запросами, какие есть: страница на одну
// запись нужна только ради `meta.total`. Отдельной ручки-счётчика для этого заводить
// не стали — она сэкономила бы round-trip и добавила бы эндпоинт, который придётся
// поддерживать вечно.

export interface Badges {
  complaints: number
  support: number
}

export async function fetchBadges(): Promise<Badges> {
  // Очередь жалоб — и ничьи, и взятые в разбор: счётчик совпадает с тем, что во вкладке.
  const [pending, reviewing, support] = await Promise.all([
    apiGetPaged<unknown>('/complaints?status=PENDING&page=1&limit=1'),
    apiGetPaged<unknown>('/complaints?status=REVIEWING&page=1&limit=1'),
    apiGetPaged<unknown>('/support?status=open&page=1&limit=1'),
  ])
  return { complaints: pending.total + reviewing.total, support: support.total }
}
