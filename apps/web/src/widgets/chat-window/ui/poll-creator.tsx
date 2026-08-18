'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import type { CreateChatPollInput } from '@studenthub/shared-schemas'
import { Button, Checkbox, Input, Modal } from '../../../shared/ui'

// Создание опроса в чате (§38–39): вопрос + 2..10 вариантов + настройки. Отправка — через onCreate.
export function PollCreator({
  onClose,
  onCreate,
  pending,
}: {
  onClose: () => void
  onCreate: (input: CreateChatPollInput) => void
  pending: boolean
}) {
  const t = useTranslations('Chats')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [allowRevote, setAllowRevote] = useState(true)
  const [randomOrder, setRandomOrder] = useState(false)

  const trimmed = options.map((o) => o.trim()).filter(Boolean)
  const canSubmit = question.trim().length > 0 && trimmed.length >= 2

  function submit(): void {
    if (!canSubmit || pending) return
    onCreate({
      question: question.trim(),
      options: trimmed,
      multiple,
      anonymous,
      allowRevote,
      randomOrder,
    })
  }

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </label>
  )

  return (
    <Modal onClose={onClose} title={t('createPoll')}>
      <div className="space-y-3">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('pollQuestion')}
          maxLength={300}
          autoFocus
        />
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={o}
                onChange={(e) =>
                  setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                }
                placeholder={t('pollOption')}
                maxLength={100}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={t('delete')}
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOptions((prev) => [...prev, ''])}
            >
              <Plus className="size-4" aria-hidden />
              {t('pollAddOption')}
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-border p-2">
          {toggle(t('pollMultiple'), multiple, setMultiple)}
          {toggle(t('pollAnonymous'), anonymous, setAnonymous)}
          {toggle(t('pollAllowRevote'), allowRevote, setAllowRevote)}
          {toggle(t('pollRandomOrder'), randomOrder, setRandomOrder)}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit || pending} onClick={submit}>
            {t('createPollSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
