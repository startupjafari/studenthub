'use client'

import { useTranslations } from 'next-intl'
import { Mail, MapPin, Phone, UserRound } from 'lucide-react'
import type { MessageContact, MessageLocation } from '../model/types'
import { cn } from '../../../shared/lib/utils'

/** Рамка карточки в пузыре — та же, что у превью ссылки: акцентная полоса слева. */
function cardClass(mine: boolean): string {
  return cn(
    'flex max-w-sm overflow-hidden rounded-xl border',
    mine ? 'border-primary-foreground/20 bg-primary-foreground/5' : 'border-border bg-muted/40',
  )
}

/**
 * Геопозиция в сообщении: подпись места и ссылка на карту. Карту не встраиваем — ссылка на
 * Apple Maps открывается и на iPhone, и в браузере (там отдаётся веб-карта).
 */
export function MessageLocationCard({
  location,
  mine,
}: {
  location: MessageLocation
  mine: boolean
}) {
  const t = useTranslations('Chats')
  const coords = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  const href = `https://maps.apple.com/?ll=${location.lat},${location.lng}${
    location.title ? `&q=${encodeURIComponent(location.title)}` : ''
  }`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(cardClass(mine), 'transition-colors hover:bg-muted/70')}
    >
      <span className="w-1 shrink-0 bg-primary/60" aria-hidden />
      <div className="flex min-w-0 flex-1 items-start gap-2 p-2.5">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {location.title || t('previewLocation')}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {location.address || coords}
          </span>
          <span className="mt-0.5 block text-xs text-primary">{t('locationOpenMap')}</span>
        </div>
      </div>
    </a>
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
