'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, ListChecks } from 'lucide-react'
import { toggleChecklistItemRequest } from '../api/chat-api'
import type { MessageChecklist } from '../model/types'
import { cn } from '../../../shared/lib/utils'

/**
 * Чек-лист в сообщении: заголовок и пункты с галочками. Отмечать может автор списка, а
 * остальные — если автор это разрешил (`othersCanMark`). Добавление пунктов на вебе не
 * сделано: его пока делает только iOS.
 *
 * Ответ на отметку — чек-лист целиком; чужие отметки приходят событием `checklist:updated`
 * (окно чата кладёт их прямо в сообщение), поэтому здесь держим только последний ответ.
 */
export function MessageChecklistView({
  checklist,
  mine,
}: {
  checklist: MessageChecklist
  mine: boolean
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  // Свой ответ на отметку — поверх пришедшего с сообщением, пока сообщение не обновится.
  const [local, setLocal] = useState<MessageChecklist | null>(null)
  const current = local && local.id === checklist.id ? local : checklist
  const canMark = mine || current.othersCanMark
  const toggle = useMutation({
    mutationFn: ({ itemId, done }: { itemId: string; done: boolean }) =>
      toggleChecklistItemRequest(current.id, itemId, done),
    onSuccess: (data) => setLocal(data),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })
  const done = current.items.filter((item) => item.done).length

  return (
    <div className="min-w-[14rem] max-w-sm space-y-1.5">
      <div className="flex items-start gap-1.5">
        <ListChecks className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">{current.title}</p>
          <p className="text-xs opacity-70">
            {t('checklistProgress', { done, total: current.items.length })}
          </p>
        </div>
      </div>
      <ul className="space-y-1">
        {current.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              disabled={!canMark || toggle.isPending}
              onClick={() => toggle.mutate({ itemId: item.id, done: !item.done })}
              className="flex w-full items-start gap-2 rounded-md text-left text-sm disabled:cursor-default"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                  item.done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-current',
                )}
                aria-hidden
              >
                {item.done && <Check className="size-3" />}
              </span>
              <span className={cn('min-w-0 break-words', item.done && 'line-through opacity-70')}>
                {item.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
