'use client'

import { useEffect, useRef } from 'react'
import { useLocale, useFormatter, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { Badge, Button, Modal } from '../../../shared/ui'
import {
  RELEASE_NOTES,
  fetchReleaseState,
  markReleaseSeen,
  noteContent,
  pickReleaseNote,
  releaseKeys,
  type ReleaseState,
} from '../../../entities/release'

/**
 * Окно «Что нового» — один раз на релиз, на всех устройствах человека.
 *
 * Почему тексты берутся из бандла, а не из API: у установленного приложения открытая
 * страница неделями живёт на старой сборке (service worker отдаёт закешированный HTML).
 * Нота, прилетевшая из API раньше нового бандла, описывала бы функции, которых у человека
 * ещё нет. Здесь же нота и код, который она описывает, приезжают одним обновлением —
 * после того, как SW применили и страница перезагрузилась (`use-sw-update.ts`).
 */
export function WhatsNewDialog() {
  const authed = useAppSelector((s) => !!s.auth.accessToken)
  const t = useTranslations('WhatsNew')
  const locale = useLocale()
  const format = useFormatter()
  const queryClient = useQueryClient()

  const { data: state } = useQuery({
    queryKey: releaseKeys.state(),
    queryFn: fetchReleaseState,
    enabled: authed,
    // Состояние меняется раз в релиз и только по действию самого пользователя —
    // перезапрашивать его при каждом фокусе окна незачем.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const decision = pickReleaseNote(RELEASE_NOTES, authed ? state : undefined)

  const seen = useMutation({
    mutationFn: markReleaseSeen,
    onSuccess: (data) => {
      // Локальное обновление вместо инвалидации: ответ уже содержит новое состояние,
      // а лишний GET на закрытие окна ничего не уточнит.
      queryClient.setQueryData<ReleaseState>(releaseKeys.state(), (prev) => ({
        version: data.version,
        seenAt: data.seenAt,
        accountCreatedAt: prev?.accountCreatedAt ?? null,
      }))
    },
    // Ошибку показывать нечего: человек прочитал ноту, а не выполнял действие. Не
    // записалось — окно всплывёт в следующий раз, это меньшее зло, чем тост об ошибке
    // поверх приветственного текста.
    onError: () => undefined,
  })

  // Новичку окно не показываем, но отметку ставим молча — иначе на следующем релизе он
  // получит сразу две ноты подряд. Ровно один раз на версию.
  const acknowledged = useRef<string | null>(null)
  const mutate = seen.mutate
  useEffect(() => {
    if (!decision || decision.action !== 'acknowledge') return
    if (acknowledged.current === decision.note.version) return
    acknowledged.current = decision.note.version
    mutate(decision.note.version)
  }, [decision, mutate])

  if (!decision || decision.action !== 'show') return null

  const { note } = decision
  const content = noteContent(note, locale)

  const close = (): void => {
    seen.mutate(note.version)
  }

  return (
    <Modal
      onClose={close}
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
          <Button onClick={close} disabled={seen.isPending}>
            {t('gotIt')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
