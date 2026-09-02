'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import type { CreateChatPollInput } from '@studenthub/shared-schemas'
import { localId } from '../../../shared/lib'
import { Button, Checkbox, FieldError, Input, Modal } from '../../../shared/ui'

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
  const tCommon = useTranslations('Common')
  const [question, setQuestion] = useState('')
  // Варианты хранятся с устойчивым id, а не одним массивом строк: удаление идёт по
  // индексу, и с key={i} React переиспользовал бы поле по позиции — после удаления
  // среднего варианта фокус и позиция курсора оставались бы на чужой строке
  // (FRONTEND_RULES §15 п. 9).
  const [options, setOptions] = useState<Array<{ id: string; text: string }>>(() => [
    { id: localId('opt'), text: '' },
    { id: localId('opt'), text: '' },
  ])
  const [multiple, setMultiple] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [allowRevote, setAllowRevote] = useState(true)
  const [randomOrder, setRandomOrder] = useState(false)

  const trimmed = options.map((o) => o.text.trim()).filter(Boolean)
  // Ошибки показываем после первой попытки создать опрос.
  const [submitted, setSubmitted] = useState(false)
  const errors = {
    question: !question.trim() ? tCommon('fieldRequired') : null,
    options: trimmed.length < 2 ? t('pollNeedTwoOptions') : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  function submit(): void {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean) || pending) return
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
        <div className="space-y-1.5">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('pollQuestion')}
            maxLength={300}
            autoFocus
            aria-invalid={!!show('question')}
          />
          <FieldError>{show('question')}</FieldError>
        </div>
        <div className="space-y-2">
          {options.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <Input
                value={o.text}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)),
                  )
                }
                placeholder={t('pollOption')}
                maxLength={100}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={t('delete')}
                  onClick={() => setOptions((prev) => prev.filter((x) => x.id !== o.id))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          <FieldError>{show('options')}</FieldError>
          {options.length < 10 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOptions((prev) => [...prev, { id: localId('opt'), text: '' }])}
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
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" size="sm" loading={pending} onClick={submit}>
            {t('createPollSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
