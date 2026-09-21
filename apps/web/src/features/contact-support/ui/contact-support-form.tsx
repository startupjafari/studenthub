'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button, SectionPanel, Textarea } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { openSupportTicket } from '../api/support-api'

// Написать в поддержку платформы.
//
// Переписка продолжается в «Чатах» — отдельного экрана переписки здесь нет намеренно:
// у ответа есть уведомления, история и вложения ровно потому, что это обычный чат.

const MIN_LENGTH = 10

export function ContactSupportForm() {
  const t = useTranslations('Support')
  const tErr = useTranslations('Errors')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (): Promise<void> => {
    setSending(true)
    try {
      const { created } = await openSupportTicket(text)
      setText('')
      // Разные сообщения: «дописали в открытое» объясняет, почему не появилось второе
      // обращение, — иначе человек решит, что отправка не сработала.
      toast.success(created ? t('sent') : t('appended'))
    } catch (error) {
      toast.error(tErr(toApiError(error).code))
    } finally {
      setSending(false)
    }
  }

  return (
    <SectionPanel
      title={t('title')}
      subtitle={t('description')}
      bodyClassName="flex flex-col gap-3 p-4"
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('placeholder')}
        rows={5}
        maxLength={4000}
        aria-label={t('title')}
      />
      <p className="text-sm text-muted-foreground">{t('answerWhere')}</p>
      <div>
        <Button onClick={() => void submit()} disabled={sending || text.trim().length < MIN_LENGTH}>
          {t('send')}
        </Button>
      </div>
    </SectionPanel>
  )
}
