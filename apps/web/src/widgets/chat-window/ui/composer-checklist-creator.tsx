'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { CHAT_CHECKLIST_LIMITS, type ChatChecklistCreateInput } from '@studenthub/shared-schemas'
import { localId } from '../../../shared/lib'
import { Button, Checkbox, FieldError, Input, Modal } from '../../../shared/ui'

/**
 * Новый чек-лист из меню скрепки (Telegram «Checklist»): заголовок, пункты и два права для
 * остальных участников — дописывать пункты и отмечать их. Отправка — через `onCreate`,
 * сообщение приедет в ленту событием message:new.
 *
 * Enter в пункте добавляет следующий и переводит курсор туда — так список набирают в
 * Telegram, не отрывая руки от клавиатуры. Пустые пункты при отправке отбрасываются.
 */
export function ComposerChecklistCreator({
  onClose,
  onCreate,
  pending,
}: {
  onClose: () => void
  onCreate: (
    input: Pick<ChatChecklistCreateInput, 'title' | 'items' | 'othersCanAdd' | 'othersCanMark'>,
  ) => void
  pending: boolean
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const [title, setTitle] = useState('')
  // Устойчивые id пунктов — по ним React узнаёт поле после удаления соседа (§15 п. 9).
  const [items, setItems] = useState<Array<{ id: string; text: string }>>(() => [
    { id: localId('item'), text: '' },
  ])
  const [othersCanAdd, setOthersCanAdd] = useState(true)
  const [othersCanMark, setOthersCanMark] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const filled = items.map((i) => i.text.trim()).filter(Boolean)
  const errors = {
    title: !title.trim() ? tCommon('fieldRequired') : null,
    items: filled.length === 0 ? t('tgComposer.checklistNeedItem') : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)
  const canAddMore = items.length < CHAT_CHECKLIST_LIMITS.ITEMS_MAX

  function addAfter(id: string | null): void {
    if (!canAddMore) return
    const next = { id: localId('item'), text: '' }
    setItems((prev) => {
      const at = id ? prev.findIndex((i) => i.id === id) + 1 : prev.length
      return [...prev.slice(0, at), next, ...prev.slice(at)]
    })
    requestAnimationFrame(() => inputs.current.get(next.id)?.focus())
  }

  function submit(): void {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean) || pending) return
    onCreate({ title: title.trim(), items: filled, othersCanAdd, othersCanMark })
  }

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </label>
  )

  return (
    <Modal onClose={onClose} title={t('tgComposer.checklistTitle')}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('tgComposer.checklistTitlePlaceholder')}
            aria-label={t('tgComposer.checklistTitlePlaceholder')}
            maxLength={CHAT_CHECKLIST_LIMITS.TITLE_MAX}
            autoFocus
            aria-invalid={!!show('title')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                inputs.current.get(items[0]?.id ?? '')?.focus()
              }
            }}
          />
          <FieldError>{show('title')}</FieldError>
        </div>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              <Input
                ref={(el) => {
                  if (el) inputs.current.set(item.id, el)
                  else inputs.current.delete(item.id)
                }}
                value={item.text}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    if (item.text.trim()) addAfter(item.id)
                  }
                  // Backspace в пустом пункте убирает его и возвращает курсор к предыдущему.
                  if (e.key === 'Backspace' && !item.text && items.length > 1) {
                    e.preventDefault()
                    const prev = items[index - 1] ?? items[index + 1]
                    setItems((all) => all.filter((x) => x.id !== item.id))
                    if (prev) requestAnimationFrame(() => inputs.current.get(prev.id)?.focus())
                  }
                }}
                placeholder={t('tgComposer.checklistItemPlaceholder')}
                aria-label={t('tgComposer.checklistItemLabel', { n: index + 1 })}
                maxLength={CHAT_CHECKLIST_LIMITS.ITEM_MAX}
              />
              {items.length > 1 && (
                <button
                  type="button"
                  aria-label={t('tgComposer.checklistRemoveItem', { n: index + 1 })}
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          <FieldError>{show('items')}</FieldError>
          {canAddMore && (
            <Button type="button" variant="ghost" size="sm" onClick={() => addAfter(null)}>
              <Plus aria-hidden />
              {t('tgComposer.checklistAddItem')}
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-border p-2">
          {toggle(t('tgComposer.checklistOthersCanAdd'), othersCanAdd, setOthersCanAdd)}
          {toggle(t('tgComposer.checklistOthersCanMark'), othersCanMark, setOthersCanMark)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" size="sm" loading={pending} onClick={submit}>
            {t('tgComposer.checklistSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
