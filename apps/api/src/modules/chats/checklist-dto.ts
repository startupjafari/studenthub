import type { Prisma } from '@prisma/client'
import { CHAT_CHECKLIST_LIMITS } from '@studenthub/shared-schemas'

/**
 * Чек-лист в форме, общей для сообщения (MESSAGE_SELECT) и ручек самого чек-листа: один
 * select на оба пути, чтобы `checklist:updated` и сообщение в истории не разошлись полями.
 */
export const CHECKLIST_SELECT = {
  id: true,
  title: true,
  othersCanAdd: true,
  othersCanMark: true,
  items: {
    select: {
      id: true,
      text: true,
      order: true,
      doneAt: true,
      doneBy: { select: { id: true, firstName: true, lastName: true } },
      // Кто добавил пункт: убрать его может он сам и автор списка — клиенту нужно это знать,
      // чтобы показать «убрать» тем, кому сервер это разрешит.
      createdById: true,
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    // Пунктов не бывает больше потолка — take страхует выборку (BACKEND_RULES §5.3).
    take: CHAT_CHECKLIST_LIMITS.ITEMS_MAX,
  },
} satisfies Prisma.ChatChecklistSelect

type ChecklistRow = Prisma.ChatChecklistGetPayload<{ select: typeof CHECKLIST_SELECT }>

export interface ChecklistItemDto {
  id: string
  text: string
  order: number
  done: boolean
  doneAt: Date | null
  doneBy: { id: string; firstName: string; lastName: string } | null
  createdById: string
}

export interface ChecklistDto {
  id: string
  title: string
  othersCanAdd: boolean
  othersCanMark: boolean
  items: ChecklistItemDto[]
}

/**
 * Клиентская форма: у пункта явный `done`, чтобы клиенту не выводить его из `doneAt`.
 * Идемпотентна — повторный прогон уже готового DTO даёт то же самое.
 */
export function toChecklistDto(row: ChecklistRow | ChecklistDto): ChecklistDto {
  return {
    id: row.id,
    title: row.title,
    othersCanAdd: row.othersCanAdd,
    othersCanMark: row.othersCanMark,
    items: row.items.map((item) => ({
      id: item.id,
      text: item.text,
      order: item.order,
      done: item.doneAt !== null,
      doneAt: item.doneAt,
      doneBy: item.doneBy,
      createdById: item.createdById,
    })),
  }
}
