'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Copy, Video } from 'lucide-react'
import {
  MEETING_PROVIDER_NAME,
  fetchEventMeeting,
  type EventMeeting,
  type MeetingProviderValue,
} from '../../../entities/event'
import { Button, Modal } from '../../../shared/ui'

/**
 * Кнопка подключения к онлайн-встрече события.
 *
 * Ссылка запрашивается по нажатию, а не при отрисовке карточки: сервер отдаёт её только
 * участникам, и тянуть её для каждой карточки списка значило бы два десятка запросов за
 * тем, что в большинстве случаев не понадобится.
 *
 * Полученная ссылка открывается не сразу, а в маленьком окне. Причина простая: открытие
 * вкладки из колбэка асинхронного запроса блокировщик всплывающих окон гасит — пользователь
 * нажал, и «ничего не произошло». В окне ссылка становится обычным `<a>`, по которому
 * человек щёлкает сам, и заодно там видно код доступа, который у Zoom отдельный.
 */
export function JoinMeetingButton({
  eventId,
  provider,
  className,
}: {
  eventId: string
  provider: MeetingProviderValue
  className?: string
}) {
  const t = useTranslations('Events')
  const format = useFormatter()
  const [meeting, setMeeting] = useState<EventMeeting | null>(null)

  const open = useMutation({
    mutationFn: () => fetchEventMeeting(eventId),
    onSuccess: setMeeting,
    onError: () => toast.error(t('meetingUnavailable')),
  })

  const providerName = MEETING_PROVIDER_NAME[provider] ?? t('meetingOther')

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        loading={open.isPending}
        onClick={() => open.mutate()}
      >
        <Video className="size-4" aria-hidden />
        {t('join')}
      </Button>

      {meeting && (
        <Modal onClose={() => setMeeting(null)} title={t('joinTitle')} size="md">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t('joinProvider', { provider: providerName })}
            </p>

            {/* Окно подключения считает сервер — здесь только показываем его границы. */}
            {!meeting.joinable && (
              <p className="rounded-xl bg-muted p-3 text-sm">
                {t('joinNotYet', {
                  time: format.dateTime(new Date(meeting.joinableFrom), {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            )}

            {meeting.passcode && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t('meetingPasscode')}</p>
                  <p className="truncate font-mono text-base">{meeting.passcode}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('copyPasscode')}
                  onClick={() => {
                    void navigator.clipboard?.writeText(meeting.passcode ?? '')
                    toast.success(t('passcodeCopied'))
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                </Button>
              </div>
            )}

            <Button asChild size="lg" className="w-full">
              {/* rel обязателен: вкладка встречи не должна получить доступ к window.opener. */}
              <a href={meeting.url} target="_blank" rel="noopener noreferrer">
                <Video className="size-4" aria-hidden />
                {t('joinOpen')}
              </a>
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
