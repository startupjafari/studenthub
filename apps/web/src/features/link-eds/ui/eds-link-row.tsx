'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useAppLocale } from '../../../shared/i18n/app-locale'
import { toast } from 'sonner'
import { CircleCheck, FileKey, Loader2, TriangleAlert } from 'lucide-react'
import type { EdsCredentialInfo, EdsLinkResult } from '@studenthub/shared-schemas'
import { isTwoFactorRequired } from '@studenthub/shared-types'
import {
  edsLinkChallengeRequest,
  edsLinkRequest,
  edsUnlinkRequest,
  type MeResponse,
} from '../../../shared/api'
import { cn, toApiError, useErrorToast } from '../../../shared/lib'
import {
  isNcaLayerError,
  signChallengeWithNcaLayer,
  useNcaLayerSupported,
  type SignedChallenge,
} from '../../../shared/lib/ncalayer'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Badge,
  Button,
  Modal,
} from '../../../shared/ui'
import { userKeys } from '../../../entities/user'
import {
  NcaLayerHint,
  edsKeys,
  isNcaLayerSetupProblem,
  useEdsEnabled,
  useNcaLayerErrorText,
  type NcaLayerSetupProblem,
} from '../../../entities/eds'
import { SecondFactorCodeField } from './second-factor-code-field'

// Вход по ЭЦП в настройках безопасности (docs/PROJECT.md §8.3 «Вход по ЭЦП»).
//
// Только ролям с обязательной 2FA: это им сервер разрешает входить ключом НУЦ, и только у них
// есть свой второй фактор, которым подтверждается привязка. Остальным строка не рисуется, а
// запрос состояния не уходит.

/** За сколько дней до конца срока сертификата предупреждать о перевыпуске. */
const EXPIRY_WARNING_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function EdsLinkRow({ me, className }: { me: MeResponse; className?: string }) {
  const t = useTranslations('Settings')
  const format = useFormatter()
  const allowed = isTwoFactorRequired(me.role)
  const enabled = useEdsEnabled(allowed)
  const supported = useNcaLayerSupported()
  // Режим окна запоминается при открытии: после привязки профиль перечитывается, `eds`
  // появляется, и заголовок окна с предупреждением не должен смениться на «перепривязку».
  const [linkMode, setLinkMode] = useState<'link' | 'relink' | null>(null)

  if (!allowed || !enabled) return null

  const eds = me.eds ?? null
  // Привязка и отвязка подтверждаются своим кодом 2FA: без неё сервер откажет. У этих ролей
  // 2FA обязательна, но на стенде без форса её может не быть — объясняем, а не ведём в отказ.
  const has2fa = me.twoFactorEnabled === true
  const canLink = supported && has2fa

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileKey className="size-4 shrink-0 text-primary" aria-hidden />
            {t('edsTitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {eds
              ? t('edsLinkedSince', {
                  date: format.dateTime(new Date(eds.linkedAt), { day: 'numeric', month: 'long' }),
                })
              : t('edsDesc')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {canLink && (
            <Button
              type="button"
              size="sm"
              variant={eds ? 'outline' : 'default'}
              onClick={() => setLinkMode(eds ? 'relink' : 'link')}
            >
              {eds ? t('edsRelink') : t('edsLink')}
            </Button>
          )}
          {eds && has2fa && <UnlinkEdsButton />}
        </div>
      </div>

      {eds && <EdsCredentialDetails eds={eds} />}

      {/* Почему нет кнопки привязки — объясняем, а не оставляем строку без действия. */}
      {!has2fa ? (
        <p className="text-xs text-muted-foreground">{t('edsNeed2fa')}</p>
      ) : (
        !supported && <p className="text-xs text-muted-foreground">{t('edsDesktopOnly')}</p>
      )}

      {linkMode && (
        <EdsLinkModal relink={linkMode === 'relink'} onClose={() => setLinkMode(null)} />
      )}
    </div>
  )
}

/** Что известно о привязанном ключе: владелец, ИИН (последние цифры), БИН, срок, вход. */
function EdsCredentialDetails({ eds }: { eds: EdsCredentialInfo }) {
  const t = useTranslations('Settings')
  const format = useFormatter()
  const notAfter = new Date(eds.certNotAfter)
  const daysLeft = Math.ceil((notAfter.getTime() - Date.now()) / DAY_MS)
  const expired = daysLeft <= 0
  const expiringSoon = !expired && daysLeft <= EXPIRY_WARNING_DAYS

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <dt className="text-muted-foreground">{t('edsOwner')}</dt>
        <dd className="truncate font-medium">{eds.subjectCn}</dd>
        <dt className="text-muted-foreground">{t('edsIin')}</dt>
        <dd className="font-mono tabular-nums">{t('edsIinMasked', { last4: eds.iinLast4 })}</dd>
        {eds.orgBin && (
          <>
            <dt className="text-muted-foreground">{t('edsBin')}</dt>
            <dd className="font-mono tabular-nums">{eds.orgBin}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('edsCertValidUntil')}</dt>
        <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {format.dateTime(notAfter, { day: 'numeric', month: 'long', year: 'numeric' })}
          {expired ? (
            <Badge variant="destructive">{t('edsCertExpired')}</Badge>
          ) : (
            expiringSoon && (
              <Badge variant="warning">{t('edsCertExpiresIn', { days: daysLeft })}</Badge>
            )
          )}
        </dd>
        <dt className="text-muted-foreground">{t('edsLastUsed')}</dt>
        <dd>
          {eds.lastUsedAt ? format.relativeTime(new Date(eds.lastUsedAt)) : t('edsNeverUsed')}
        </dd>
      </dl>
      {(expired || expiringSoon) && (
        <p className="text-xs text-muted-foreground">{t('edsCertRenewHint')}</p>
      )}
    </div>
  )
}

/**
 * Отвязка — по своему коду 2FA, как отключение 2FA. Действие разрушительное, поэтому без
 * автоотправки: полный код только включает кнопку, отвязывает нажатие.
 */
function UnlinkEdsButton() {
  const t = useTranslations('Settings')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [complete, setComplete] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const resetCode = () => {
    setCode('')
    setComplete(false)
  }

  const unlink = useMutation({
    mutationFn: (value: string) => edsUnlinkRequest(value),
    onSuccess: () => {
      resetCode()
      setFailed(false)
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: userKeys.me() })
      toast.success(t('edsUnlinkedToast'))
    },
    onError: (error) => {
      resetCode()
      const errorCode = toApiError(error).code
      if (errorCode === 'INVALID_2FA_CODE') {
        setFailed(true)
        setAttempt((n) => n + 1)
      }
      // 400 — привязки уже нет (сбросил администратор, отвязали в другой вкладке): цель
      // достигнута, экран просто отстал — перечитываем профиль вместо ошибки.
      if (errorCode === 'BAD_REQUEST') {
        setOpen(false)
        void queryClient.invalidateQueries({ queryKey: userKeys.me() })
        return
      }
      if (errorCode === 'FEATURE_DISABLED') {
        void queryClient.invalidateQueries({ queryKey: edsKeys.config() })
      }
      toast.error(tErr(errorCode))
    },
  })

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          resetCode()
          setFailed(false)
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          {t('edsUnlink')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('edsUnlinkTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('edsUnlinkDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <form
          id="eds-unlink-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete && !unlink.isPending) unlink.mutate(code)
          }}
        >
          <SecondFactorCodeField
            id="eds-unlink-code"
            value={code}
            onChange={(value, isComplete) => {
              setCode(value)
              setComplete(isComplete)
            }}
            disabled={unlink.isPending}
            invalid={failed}
            resetKey={attempt}
          />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={unlink.isPending}>{t('twoFactorCancel')}</AlertDialogCancel>
          <Button
            type="submit"
            form="eds-unlink-form"
            variant="destructive"
            loading={unlink.isPending}
            disabled={!complete}
          >
            {t('edsUnlink')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type SignStage = 'idle' | 'connecting' | 'awaiting'

/**
 * Окно привязки: сначала подпись в NCALayer, потом код 2FA. Порядок не случаен: выбор ключа
 * и ввод его пароля занимают минуту, и код, набранный до них, успел бы смениться в
 * приложении-аутентификаторе.
 */
function EdsLinkModal({ relink, onClose }: { relink: boolean; onClose: () => void }) {
  const t = useTranslations('Settings')
  const tAuth = useTranslations('Auth')
  const locale = useAppLocale()
  const queryClient = useQueryClient()
  const errorToast = useErrorToast('eds-link')
  const ncaLayerErrorText = useNcaLayerErrorText()
  const [stage, setStage] = useState<SignStage>('idle')
  const [problem, setProblem] = useState<NcaLayerSetupProblem | null>(null)
  const [signed, setSigned] = useState<(SignedChallenge & { expiresAt: string }) | null>(null)
  const [code, setCode] = useState('')
  const [complete, setComplete] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Привязка выполнена, но ФИО в сертификате не совпало с профилем — окно остаётся открытым
  // с предупреждением: тост исчез бы раньше, чем его прочтут.
  const [mismatch, setMismatch] = useState<EdsLinkResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Окно закрыли посреди подписи — сокет NCALayer закрываем вместе с ним.
  useEffect(() => () => abortRef.current?.abort(), [])

  async function sign() {
    if (stage !== 'idle') return
    setProblem(null)
    const controller = new AbortController()
    abortRef.current = controller
    setStage('connecting')
    let expiresAt = ''
    try {
      const result = await signChallengeWithNcaLayer(
        async () => {
          const challenge = await edsLinkChallengeRequest()
          expiresAt = challenge.expiresAt
          return challenge
        },
        { locale, signal: controller.signal, onAwaitingKey: () => setStage('awaiting') },
      )
      setSigned({ ...result, expiresAt })
    } catch (error) {
      if (!isNcaLayerError(error)) {
        errorToast.show(error)
      } else if (isNcaLayerSetupProblem(error.kind)) {
        setProblem(error.kind)
      } else {
        const text = ncaLayerErrorText(error.kind)
        if (text) toast.error(text, { id: 'eds-link' })
      }
    } finally {
      setStage('idle')
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const link = useMutation({
    mutationFn: (input: SignedChallenge & { code: string }) => edsLinkRequest(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.me() })
      if (result.nameMismatch) {
        setMismatch(result)
        return
      }
      toast.success(t('edsLinkedToast'))
      onClose()
    },
    onError: (error) => {
      setCode('')
      setComplete(false)
      const errorCode = toApiError(error).code
      // Неверный код — подпись ещё годится, достаточно ввести код заново: ячейки очищаются,
      // фокус в первой. Остальные отказы про саму подпись или ключ (устарела, не тот ключ,
      // ключ чужой) — подписывать снова.
      if (errorCode === 'INVALID_2FA_CODE') {
        setFailed(true)
        setAttempt((n) => n + 1)
      } else if (errorCode !== 'RATE_LIMIT') {
        setSigned(null)
      }
      if (errorCode === 'FEATURE_DISABLED') {
        void queryClient.invalidateQueries({ queryKey: edsKeys.config() })
      }
      errorToast.show(error)
    },
  })

  function submit(value: string) {
    if (!signed || link.isPending) return
    // Challenge живёт минуты: просроченную подпись сервер всё равно отвергнет.
    if (Date.parse(signed.expiresAt) <= Date.now()) {
      setSigned(null)
      toast.error(t('edsSignatureStale'), { id: 'eds-link' })
      return
    }
    link.mutate({ challengeId: signed.challengeId, cms: signed.cms, code: value })
  }

  const title = relink ? t('edsRelinkTitle') : t('edsLinkTitle')

  if (mismatch) {
    return (
      <Modal onClose={onClose} title={title} size="md">
        <div className="flex flex-col gap-4">
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t('edsNameMismatchTitle')}</AlertTitle>
            <AlertDescription>
              {t('edsNameMismatch', { name: mismatch.subjectCn })}
            </AlertDescription>
          </Alert>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t('twoFactorDone')}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  // Разметка — как у мастера включения 2FA в тех же настройках: шаги сверху вниз без
  // разделителей, кнопки справа внизу.
  return (
    <Modal onClose={onClose} title={title} size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm">{t('edsLinkStepSign')}</p>
        {signed ? (
          <p className="flex items-center gap-2 text-sm text-success" role="status">
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            {t('edsSigned')}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            loading={stage !== 'idle'}
            onClick={() => void sign()}
            className="self-start"
          >
            <FileKey className="size-4" aria-hidden />
            {t('edsSign')}
          </Button>
        )}
        {stage === 'awaiting' && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              {tAuth('edsAwaitingKey')}
            </span>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="cursor-pointer rounded font-medium underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {tAuth('edsCancel')}
            </button>
          </div>
        )}
        {problem && <NcaLayerHint problem={problem} />}

        {/* Код — только после подписи (см. комментарий у окна). Полный код отправляется сам,
            как на входе; «Привязать» — запасной путь. */}
        {signed && (
          <form
            id="eds-link-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete) submit(code)
            }}
          >
            <SecondFactorCodeField
              id="eds-link-code"
              value={code}
              onChange={(value, isComplete) => {
                setCode(value)
                setComplete(isComplete)
              }}
              onComplete={submit}
              disabled={link.isPending}
              invalid={failed}
              resetKey={attempt}
            />
          </form>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={link.isPending}>
            {t('twoFactorCancel')}
          </Button>
          {signed && (
            <Button
              type="submit"
              form="eds-link-form"
              loading={link.isPending}
              disabled={!complete}
            >
              {relink ? t('edsRelinkConfirm') : t('edsLinkConfirm')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
