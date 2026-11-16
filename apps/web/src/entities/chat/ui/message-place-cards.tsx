'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, Mail, MapPin, Phone, Radio, Square, UserRound } from 'lucide-react'
import { chatKeys, stopLiveLocationRequest } from '../api/chat-api'
import {
  applyLocationUpdate,
  isLiveLocation,
  LIVE_LOCATION_TICK_MS,
  liveUpdatedMinutesAgo,
} from '../lib/live-location'
import type { ChatMessage, MessageContact, MessageLocation } from '../model/types'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Рамка карточки в пузыре — та же, что у превью ссылки: акцентная полоса слева. */
function cardClass(mine: boolean): string {
  return cn(
    'flex max-w-sm overflow-hidden rounded-xl border',
    mine ? 'border-primary-foreground/20 bg-primary-foreground/5' : 'border-border bg-muted/40',
  )
}

/**
 * «Сейчас» для карточки трансляции: тикает, пока трансляция идёт, — подписи «обновлено
 * N мин назад» и сама трансляция не должны застывать в момент рендера. Отдельный таймер
 * на срок — чтобы карточка стала обычной точкой ровно в `liveUntil`, а не на следующем тике.
 */
function useLiveNow(location: MessageLocation): number {
  const [now, setNow] = useState(() => Date.now())
  const live = isLiveLocation(location, now)
  const until = location.liveUntil
  useEffect(() => {
    if (!live) return
    const tick = setInterval(() => setNow(Date.now()), LIVE_LOCATION_TICK_MS)
    const remaining = until ? Date.parse(until) - Date.now() : NaN
    const end = remaining > 0 ? setTimeout(() => setNow(Date.now()), remaining + 50) : undefined
    return () => {
      clearInterval(tick)
      if (end) clearTimeout(end)
    }
  }, [live, until])
  return now
}

/**
 * Геопозиция в сообщении: подпись места и ссылка на карту. Карту не встраиваем — ссылка на
 * Apple Maps открывается и на iPhone, и в браузере (там отдаётся веб-карта).
 *
 * Трансляция (`liveUntil` в будущем): срок, давность последней точки и у своей — кнопка
 * «Остановить». Новые точки приходят событием `location:updated` (окно чата кладёт их в
 * сообщение); после срока карточка рисуется обычной точкой. Начать трансляцию с веба
 * нельзя — браузер не умеет слать геопозицию в фоне.
 */
export function MessageLocationCard({
  location,
  mine,
  messageId,
  chatId,
}: {
  location: MessageLocation
  mine: boolean
  messageId: string
  chatId: string
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const now = useLiveNow(location)
  const live = isLiveLocation(location, now)
  const stop = useMutation({
    mutationFn: () => stopLiveLocationRequest(messageId),
    // Ответ — геопозиция после остановки: кладём её в ленту сразу, не дожидаясь события.
    onSuccess: (next) =>
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(chatId), (old) =>
        applyLocationUpdate(old, { chatId, messageId, location: next }),
      ),
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })
  const coords = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  const href = `https://maps.apple.com/?ll=${location.lat},${location.lng}${
    location.title ? `&q=${encodeURIComponent(location.title)}` : ''
  }`
  const updatedMin = live ? liveUpdatedMinutesAgo(location, now) : null
  const untilText =
    live && location.liveUntil
      ? new Date(location.liveUntil).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
  const Icon = live ? Radio : MapPin
  return (
    <div className={cn(cardClass(mine), 'flex-col')}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex min-w-0 transition-colors hover:bg-muted/70"
      >
        <span className="w-1 shrink-0 bg-primary/60" aria-hidden />
        <div className="flex min-w-0 flex-1 items-start gap-2 p-2.5">
          <Icon className={cn('mt-0.5 size-4 shrink-0', live && 'animate-pulse')} aria-hidden />
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {location.title || (live ? t('liveLocationTitle') : t('previewLocation'))}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {location.address || coords}
            </span>
            {untilText && (
              <span className="block truncate text-xs">
                {t('liveLocationUntil', { time: untilText })}
              </span>
            )}
            {updatedMin !== null && (
              <span className="block truncate text-xs text-muted-foreground">
                {updatedMin < 60
                  ? t('liveLocationUpdatedMin', { count: updatedMin })
                  : t('liveLocationUpdatedHour', { count: Math.floor(updatedMin / 60) })}
              </span>
            )}
            <span className="mt-0.5 block text-xs text-primary">{t('locationOpenMap')}</span>
          </div>
        </div>
      </a>
      {live && mine && (
        // Кнопка только у своей трансляции, а свой пузырь — цвета primary: подсветка и
        // разделитель — от его текста, иначе ghost-кнопка красит фон в muted.
        <div className="border-t border-primary-foreground/20 p-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full hover:bg-primary-foreground/10 hover:text-primary-foreground"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3.5" aria-hidden />
            )}
            {t('liveLocationStop')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Карточка контакта: имя, телефоны и адреса почты ссылками tel:/mailto:. */
export function MessageContactCard({ contact, mine }: { contact: MessageContact; mine: boolean }) {
  return (
    <div className={cardClass(mine)}>
      <span className="w-1 shrink-0 bg-primary/60" aria-hidden />
      <div className="flex min-w-0 flex-1 items-start gap-2 p-2.5">
        <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <span className="block truncate text-sm font-medium">{contact.name}</span>
          {contact.phones.map((phone) => (
            <a
              key={`p:${phone}`}
              href={`tel:${phone.replace(/[^\d+]/g, '')}`}
              className="flex items-center gap-1 text-xs hover:underline"
            >
              <Phone className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{phone}</span>
            </a>
          ))}
          {contact.emails.map((email) => (
            <a
              key={`e:${email}`}
              href={`mailto:${email}`}
              className="flex items-center gap-1 text-xs hover:underline"
            >
              <Mail className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{email}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
