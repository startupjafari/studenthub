'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Copy, Send } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  miniLinkCodeRequest,
  miniLinkRevokeRequest,
  miniLinkStatusRequest,
} from '../../../shared/api'
import { Button, useConfirm } from '../../../shared/ui'

// Привязка Telegram для админского мини-аппа (docs/PROJECT.md §Мини-апп).
//
// Код выдаётся здесь, а не в самом мини-аппе: только в вебе платформа знает, кто человек —
// он прошёл логин и 2FA. Telegram в первом запросе доказывает лишь то, что он Telegram.
//
// Видно только платформенным ролям: остальным мини-апп недоступен, и предлагать привязку
// значило бы обещать экран, на который потом не пустят.

const MINI_APP_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

const linkKeys = { status: ['mini', 'link'] as const }

export function TelegramLinkRow({ role }: { role: Role }) {
  const t = useTranslations('Settings')
  const format = useFormatter()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [code, setCode] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [copied, setCopied] = useState(false)

  // Состояние привязки: без него на экране была одна кнопка «Получить код» и ни слова о
  // том, привязан ли уже Telegram и какой. Потерянный телефон при этом отзывался только
  // правкой в базе.
  const status = useQuery({ queryKey: linkKeys.status, queryFn: miniLinkStatusRequest })

  const revoke = useMutation({
    mutationFn: miniLinkRevokeRequest,
    onSuccess: () => {
      toast.success(t('telegramRevoked'))
      void queryClient.invalidateQueries({ queryKey: linkKeys.status })
    },
    onError: (error: unknown) => toast.error(errorText(error, t)),
  })

  const issue = useMutation({
    mutationFn: miniLinkCodeRequest,
    onSuccess: (data) => {
      setCode(data.code)
      setSecondsLeft(data.expiresIn)
      setCopied(false)
      void queryClient.invalidateQueries({ queryKey: linkKeys.status })
    },
    // Единственная ожидаемая ошибка — упереться в лимит: код выдаётся десять раз в час.
    onError: (error: unknown) => toast.error(errorText(error, t)),
  })

  // Обратный отсчёт. Код живёт минуты, и показывать его после истечения — обманывать:
  // человек введёт его в боте и получит отказ без объяснения.
  useEffect(() => {
    if (secondsLeft <= 0) {
      if (code) setCode(null)
      return
    }
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft, code])

  if (!MINI_APP_ROLES.includes(role)) return null

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обмена недоступен (не-https, отказ в разрешении) — код и так на экране.
      toast.error(t('telegramCopyFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Send className="size-4 text-primary" aria-hidden />
            {t('telegramTitle')}
          </p>
          {/* Привязан или нет — первое, что нужно знать: у кого-то Telegram привязан
              годами, и «Получить код» без этой строки выглядит так, будто привязки нет. */}
          <p className="text-xs text-muted-foreground">
            {status.data?.linked
              ? t('telegramLinkedAs', {
                  account: status.data.username
                    ? `@${status.data.username}`
                    : t('telegramNoUsername'),
                  date: status.data.linkedAt
                    ? format.dateTime(new Date(status.data.linkedAt), {
                        day: 'numeric',
                        month: 'long',
                      })
                    : '',
                })
              : t('telegramDesc')}
          </p>
          {status.data?.linked && status.data.lastSeenAt && (
            <p className="text-xs text-muted-foreground">
              {t('telegramLastSeen', {
                date: format.relativeTime(new Date(status.data.lastSeenAt)),
              })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {status.data?.linked && (
            <Button
              size="sm"
              variant="outline"
              loading={revoke.isPending}
              onClick={async () => {
                // Подтверждение обязательно: отзыв мгновенно закрывает доступ с телефона,
                // и человек, нажавший мимо, обнаружит это уже в Telegram.
                if (await confirm({ description: t('telegramRevokeConfirm') })) revoke.mutate()
              }}
            >
              {t('telegramRevoke')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            loading={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {code ? t('telegramNewCode') : t('telegramGetCode')}
          </Button>
        </div>
      </div>

      {code && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
          {/* Код набирают с экрана на телефоне: крупный моноширинный с разрядкой. */}
          <span className="font-mono text-xl font-semibold tracking-[0.3em]">{code}</span>
          <Button size="sm" variant="ghost" onClick={copy} aria-label={t('telegramCopy')}>
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('telegramExpiresIn', { time: formatLeft(secondsLeft) })}
          </span>
          <p className="w-full text-xs text-muted-foreground">{t('telegramHint')}</p>
        </div>
      )}
    </div>
  )
}

/** `4:37` — привычный вид обратного отсчёта, без «осталось 277 секунд». */
function formatLeft(seconds: number): string {
  const safe = Math.max(0, seconds)
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/** Текст ошибки — по коду из ответа, а не по сообщению бэкенда (FRONTEND_RULES §5.4). */
function errorText(error: unknown, t: (key: string) => string): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  return code === 'RATE_LIMIT' ? t('telegramRateLimit') : t('telegramFailed')
}
