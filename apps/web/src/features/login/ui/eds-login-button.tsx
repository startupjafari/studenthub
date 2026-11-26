'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useAppLocale } from '../../../shared/i18n/app-locale'
import { toast } from 'sonner'
import { FileKey, Loader2 } from 'lucide-react'
import { edsChallengeRequest, edsLoginRequest } from '../../../shared/api'
import { toApiError } from '../../../shared/lib'
import {
  isNcaLayerError,
  signChallengeWithNcaLayer,
  useNcaLayerSupported,
} from '../../../shared/lib/ncalayer'
import { Button } from '../../../shared/ui'
import {
  edsKeys,
  isNcaLayerSetupProblem,
  useEdsEnabled,
  useNcaLayerErrorText,
  useNcaLayerHint,
} from '../../../entities/eds'

type Stage = 'idle' | 'connecting' | 'awaiting' | 'verifying'

/**
 * «Войти с ЭЦП»: NCALayer → challenge → подпись ключом AUTH_* → вход (docs/PROJECT.md §8.3).
 * Видна, только если вход по ЭЦП включён на сервере и устройство вообще умеет NCALayer
 * (десктоп): на телефоне кнопка вела бы в тупик.
 *
 * После входа — то же, что после пароля и 2FA: `onAuthenticated` заводит сессию и уводит
 * на домашний экран роли. Отказ сервера уходит в общий тост входа (`onFailure`) — текст по
 * коду: не тот ключ, ЭЦП не привязана, проверка недоступна.
 */
export function EdsLoginButton({
  onAuthenticated,
  onFailure,
}: {
  onAuthenticated: (accessToken: string) => Promise<void>
  onFailure: (error: unknown) => void
}) {
  const t = useTranslations('Auth')
  const locale = useAppLocale()
  const queryClient = useQueryClient()
  const supported = useNcaLayerSupported()
  const enabled = useEdsEnabled(supported)
  const ncaLayerErrorText = useNcaLayerErrorText()
  // Подсказка «запустите / разрешите / обновите NCALayer» — в том же тосте, что и отказы входа.
  const ncaLayerHint = useNcaLayerHint('login-error')
  const [stage, setStage] = useState<Stage>('idle')
  const abortRef = useRef<AbortController | null>(null)

  // Ушли со страницы посреди операции — сокет NCALayer закрываем, а не бросаем открытым.
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!supported || !enabled) return null

  async function start() {
    if (stage !== 'idle') return
    const controller = new AbortController()
    abortRef.current = controller
    setStage('connecting')
    try {
      const signed = await signChallengeWithNcaLayer(edsChallengeRequest, {
        locale,
        signal: controller.signal,
        onAwaitingKey: () => setStage('awaiting'),
      })
      setStage('verifying')
      const token = await edsLoginRequest(signed)
      // Дальше — переход на домашний экран; кнопка остаётся в загрузке до ухода со страницы.
      await onAuthenticated(token)
    } catch (error) {
      setStage('idle')
      if (isNcaLayerError(error)) {
        if (isNcaLayerSetupProblem(error.kind)) {
          ncaLayerHint.show(error.kind)
          return
        }
        const text = ncaLayerErrorText(error.kind)
        // Отмену человек сделал сам — сообщать о ней незачем.
        if (text) toast.error(text, { id: 'login-error' })
        return
      }
      // Вход по ЭЦП выключили, пока страница была открыта, — кнопка уходит вместе с ним.
      if (toApiError(error).code === 'FEATURE_DISABLED') {
        void queryClient.invalidateQueries({ queryKey: edsKeys.config() })
      }
      onFailure(error)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        size="xl"
        className="w-full"
        loading={stage !== 'idle'}
        onClick={() => void start()}
      >
        <FileKey className="size-4" aria-hidden />
        {t('edsSignIn')}
      </Button>
      {stage === 'awaiting' && (
        // Окно NCALayer открывается поверх браузера, а иногда — за ним: говорим, где искать.
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            {t('edsAwaitingKey')}
          </span>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="cursor-pointer rounded font-medium underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {t('edsCancel')}
          </button>
        </div>
      )}
    </div>
  )
}
