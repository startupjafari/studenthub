'use client'

import { useLocale, useFormatter, useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { Badge, Button, Modal } from '../../../shared/ui'
import { noteContent } from '../lib/note-content'
import type { ReleaseNote } from '../model/types'

export interface ReleaseNoteModalProps {
  note: ReleaseNote
  onClose: () => void
  /** Кнопка «Понятно» ждёт запись отметки — чтобы двойной клик не отправил её дважды. */
  busy?: boolean
}

/**
 * Окно с текстом релиза. Только отображение: что показывать и показывать ли вообще,
 * решают снаружи — автоматически (`widgets/whats-new`) или по кнопке в настройках.
 */
export function ReleaseNoteModal({ note, onClose, busy }: ReleaseNoteModalProps) {
  const t = useTranslations('WhatsNew')
  const locale = useLocale()
  const format = useFormatter()
  const content = noteContent(note, locale)

  return (
    <Modal
      onClose={onClose}
      size="lg"
      bodyClassName="overflow-hidden p-0"
      title={
        <span className="inline-flex items-center gap-1.5 text-primary">
          <Sparkles className="size-4" aria-hidden />
          <span className="text-xs font-semibold tracking-wide uppercase">{t('title')}</span>
        </span>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-xl leading-snug font-semibold text-balance">{content.title}</h2>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge>v{note.version}</Badge>
            <time dateTime={note.date}>
              {format.dateTime(new Date(`${note.date}T00:00:00Z`), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t border-border px-5 py-4">
          {content.intro && (
            <p className="text-sm leading-relaxed text-muted-foreground">{content.intro}</p>
          )}

          {content.sections.map((section, i) => (
            <section key={section.heading ?? `section-${i}`} className="space-y-3">
              {section.heading && (
                <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
              )}
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li key={item.title} className="flex gap-2.5 text-sm leading-relaxed">
                    <span aria-hidden className="mt-px shrink-0 text-base leading-snug">
                      {item.icon ?? '•'}
                    </span>
                    <span className="min-w-0 text-muted-foreground">
                      <span className="font-medium text-foreground">{item.title}</span>
                      {item.text ? ` — ${item.text}` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button onClick={onClose} disabled={busy}>
            {t('gotIt')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
