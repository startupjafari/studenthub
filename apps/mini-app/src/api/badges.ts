import { apiGetPaged } from './client'

// Числа на вкладках. Считаются двумя самыми дешёвыми запросами, какие есть: страница на
// одну запись нужна только ради `meta.total`. Отдельной ручки-счётчика для этого заводить
// не стали — она сэкономила бы один round-trip и добавила бы эндпоинт, который придётся
// поддерживать вечно.

export interface Badges {
  complaints: number
  support: number
}

export async function fetchBadges(): Promise<Badges> {
  const [complaints, support] = await Promise.all([
    apiGetPaged<unknown>('/complaints?status=PENDING&page=1&limit=1'),
    apiGetPaged<unknown>('/support?status=open&page=1&limit=1'),
  ])
  return { complaints: complaints.total, support: support.total }
}
