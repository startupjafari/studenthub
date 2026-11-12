'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, ListChecks, Loader2, Plus, X } from 'lucide-react'
import {
  CHAT_CHECKLIST_LIMITS,
  ChatChecklistItemAddSchema,
  type ChatChecklistItemAddInput,
} from '@studenthub/shared-schemas'
import {
  addChecklistItemRequest,
  chatKeys,
  removeChecklistItemRequest,
  toggleChecklistItemRequest,
} from '../api/chat-api'
import {
  canAddChecklistItem,
  canMarkChecklist,
  canRemoveChecklistItem,
} from '../lib/checklist-permissions'
import type { ChatMessage, MessageChecklist } from '../model/types'
import { FieldError, Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

function errorCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

/**
 * Чек-лист в сообщении: заголовок, пункты с галочками, добавление и удаление пунктов.
 * Права — как на сервере (`checklist-permissions`): отмечать и добавлять может автор списка,
 * а остальные — если автор это разрешил; убирать пункт — автор списка или добавивший пункт.
 *
 * Ответ на любое действие — чек-лист целиком: кладём его прямо в сообщение ленты (тот же путь,
 * что у события `checklist:updated`, которое получают остальные участники).
 */
export function MessageChecklistView({
  checklist,
  mine,
  chatId,
  viewerId,
}: {
  checklist: MessageChecklist
  mine: boolean
  chatId: string
  viewerId?: string
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  // Свой ответ — поверх пришедшего с сообщением, пока не придёт новый проп (лента обновится
  // этим же ответом или событием). Сравнение по ссылке: новый проп всегда свежее ответа.
  const [local, setLocal] = useState<{ base: MessageChecklist; value: MessageChecklist } | null>(
    null,
  )
  const current = local && local.base === checklist ? local.value : checklist
  const [adding, setAdding] = useState(false)

  const apply = (next: MessageChecklist): void => {
    setLocal({ base: checklist, value: next })
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
      old?.map((m) => (m.checklist?.id === next.id ? { ...m, checklist: next } : m)),
    )
  }
  const onError = (e: unknown): void => {
    toast.error(tErr(errorCode(e)))
  }

  const toggle = useMutation({
    mutationFn: ({ itemId, done }: { itemId: string; done: boolean }) =>
      toggleChecklistItemRequest(current.id, itemId, done),
    onSuccess: apply,
    onError,
  })
  const remove = useMutation({
    mutationFn: (itemId: string) => removeChecklistItemRequest(current.id, itemId),
    onSuccess: apply,
    onError,
  })

  const canMark = canMarkChecklist(current, mine)
  const canAdd = canAddChecklistItem(current, mine)
  const done = current.items.filter((item) => item.done).length
  const busy = toggle.isPending || remove.isPending

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
          <li key={item.id} className="group/item flex items-start gap-1">
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              disabled={!canMark || busy}
              onClick={() => toggle.mutate({ itemId: item.id, done: !item.done })}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left text-sm disabled:cursor-default"
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
            {canRemoveChecklistItem(item, mine, viewerId) && (
              // На устройствах без наведения крестик виден всегда, с наведением — у пункта
              // под курсором или в фокусе, чтобы список не рябил крестиками.
              <button
                type="button"
                aria-label={t('checklistRemoveItem', { text: item.text })}
                disabled={busy}
                onClick={() => remove.mutate(item.id)}
                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:cursor-default [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-60"
              >
                {remove.isPending && remove.variables === item.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canAdd &&
        (adding ? (
          <ChecklistAddForm
            checklistId={current.id}
            onAdded={(next) => {
              apply(next)
              // После добавления поле остаётся открытым — пункты обычно вносят пачкой.
              // Упёрлись в потолок — закрываем: следующего всё равно не принять.
              if (next.items.length >= CHAT_CHECKLIST_LIMITS.ITEMS_MAX) setAdding(false)
            }}
            onCancel={() => setAdding(false)}
            onError={onError}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-2 rounded-md text-sm opacity-80 transition-opacity hover:opacity-100"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            {t('checklistAddItem')}
          </button>
        ))}
    </div>
  )
}

/** Поле нового пункта: Enter — добавить, Escape — закрыть. */
function ChecklistAddForm({
  checklistId,
  onAdded,
  onCancel,
  onError,
}: {
  checklistId: string
  onAdded: (next: MessageChecklist) => void
  onCancel: () => void
  onError: (e: unknown) => void
}) {
  const t = useTranslations('Chats')
  const form = useForm<ChatChecklistItemAddInput>({
    resolver: zodResolver(ChatChecklistItemAddSchema),
    defaultValues: { text: '' },
  })
  const add = useMutation({
    mutationFn: (input: ChatChecklistItemAddInput) =>
      addChecklistItemRequest(checklistId, input.text),
    onSuccess: (next) => {
      form.reset({ text: '' })
      onAdded(next)
    },
    onError,
  })
  const fieldId = `checklist-add-${checklistId}`
  const error = form.formState.errors.text?.message
  return (
    // Поле не блокируем на время запроса — иначе оно теряет фокус, а пункты вносят пачкой;
    // от двойной отправки защищает проверка isPending.
    <form
      onSubmit={form.handleSubmit((v) => {
        if (!add.isPending) add.mutate(v)
      })}
      className="flex flex-col gap-1"
    >
      <label htmlFor={fieldId} className="sr-only">
        {t('checklistNewItem')}
      </label>
      <div className="flex items-center gap-1">
        <Input
          id={fieldId}
          size="sm"
          autoFocus
          maxLength={CHAT_CHECKLIST_LIMITS.ITEM_MAX}
          placeholder={t('checklistNewItem')}
          aria-invalid={error ? true : undefined}
          // Поле лежит в пузыре: в своём пузыре текст наследовал бы цвет primary-foreground.
          className="text-foreground select-text"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          {...form.register('text')}
        />
        <button
          type="submit"
          aria-label={t('checklistAddItem')}
          disabled={add.isPending}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-current/10 disabled:cursor-default"
        >
          {add.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label={t('checklistAddCancel')}
          onClick={onCancel}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-current/10"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {/* Длину режет maxLength поля, так что ошибка схемы здесь одна — пустой пункт. */}
      <FieldError className="text-xs">{error ? t('checklistItemEmpty') : undefined}</FieldError>
    </form>
  )
}
