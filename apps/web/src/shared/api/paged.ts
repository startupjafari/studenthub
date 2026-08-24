import { api } from './instance'
import type { ResponseWithMeta } from './instance'

/** Страница списка: строки и общее число строк во всей выборке (для пагинации). */
export interface Paged<T> {
  items: T[]
  total: number
}

// Бэкенд отдаёт списки как { success, data, meta }, interceptor разворачивает data и
// оставляет meta рядом (FRONTEND_RULES §5.2). Таблице нужно и то и другое: строки —
// показать, `meta.total` — посчитать число страниц. Фолбэк на длину страницы нужен для
// эндпоинтов без Paginated: пагинация тогда покажет одну страницу, а не «0 из 0».
export async function getPaged<T>(url: string, params: Record<string, unknown>): Promise<Paged<T>> {
  const res = await api.get<T[]>(url, { params })
  const total = (res as ResponseWithMeta).meta?.total
  return { items: res.data, total: total ?? res.data.length }
}
