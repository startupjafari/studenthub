'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

/**
 * Обновление приложения из-под service worker.
 *
 * Без этого установленное приложение неделями работает на старом бандле: SW отдаёт
 * закешированный HTML, а чанков, которые тот запрашивает, после деплоя на сервере уже
 * нет — страница падает с ChunkLoadError или белым экраном. Вкладку бы перезагрузили,
 * а PWA с домашнего экрана не закрывают.
 *
 * Поэтому: следим за появлением нового SW и предлагаем перезагрузиться. Тост не
 * закрывается сам и не перезагружает страницу за спиной — человек может дописывать
 * сообщение или заполнять форму.
 */

const RELOADED_KEY = 'sh:chunk-reload'

/** Версия текущей сборки — её же Next использует как buildId (см. next.config.mjs). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'

export type UpdateState = 'idle' | 'checking' | 'ready' | 'current'

export interface AppUpdate {
  /** Версия, на которой работает открытая страница. */
  version: string
  state: UpdateState
  /** Проверить обновление вручную — кнопка «Обновить» в настройках. */
  check: () => void
  /** Применить скачанное обновление: активировать новый SW и перезагрузиться. */
  apply: () => void
}

export function useServiceWorkerUpdate(): void {
  useAppUpdate()
}

/**
 * То же, что `useServiceWorkerUpdate`, но отдаёт состояние наружу — для экрана настроек,
 * где обновление можно проверить руками, не дожидаясь, пока система соизволит.
 */
export function useAppUpdate(): AppUpdate {
  const t = useTranslations('Common')
  // Переводы в замыкании слушателей: держим в ref, чтобы не переподписываться на смене локали.
  const tRef = useRef(t)
  tRef.current = t
  const [state, setState] = useState<UpdateState>('idle')
  // Регистрация нужна и обработчикам внутри эффекта, и кнопке снаружи.
  const regRef = useRef<ServiceWorkerRegistration | null>(null)
  const waitingRef = useRef<ServiceWorker | null>(null)

  const apply = useCallback(() => {
    const waiting = waitingRef.current
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
    else window.location.reload()
  }, [])

  const check = useCallback(() => {
    const reg = regRef.current
    if (!reg) {
      // SW не зарегистрирован (первый заход, приватное окно, http) — обновлять нечего,
      // но человек нажал кнопку и обязан увидеть ответ.
      setState('current')
      return
    }
    setState('checking')
    void reg
      .update()
      .then(() => {
        // update() уже разрешился: если новый SW нашёлся, он в installing/waiting.
        setState(reg.waiting || reg.installing ? 'ready' : 'current')
      })
      .catch(() => setState('current'))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let reloading = false
    const reload = (): void => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }

    // Новый SW уже активировался (сам или по нашей команде) — страница всё ещё на старом
    // коде, поэтому перезагрузка обязательна. Первый контроллер (его не было вовсе) не в счёт.
    const onControllerChange = (): void => {
      if (navigator.serviceWorker.controller) reload()
    }

    const promptUpdate = (waiting: ServiceWorker | null): void => {
      waitingRef.current = waiting
      setState('ready')
      toast(tRef.current('updateAvailable'), {
        id: 'sw-update',
        duration: Infinity,
        action: {
          label: tRef.current('updateAction'),
          onClick: () => {
            // Ждущий SW активируется по сообщению (worker/index.ts) — дальше нас
            // разбудит controllerchange. Если ждущего нет, обновление уже применилось.
            if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
            else reload()
          },
        },
      })
    }

    let registration: ServiceWorkerRegistration | null = null
    let disposed = false
    const onUpdateFound = (): void => {
      const installing = registration?.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        // `controller` есть — значит это не первая установка, а именно обновление.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          promptUpdate(registration?.waiting ?? null)
        }
      })
    }

    const attach = (reg: ServiceWorkerRegistration): void => {
      if (disposed || registration) return
      registration = reg
      regRef.current = reg
      // Обновление могло установиться, пока приложение было закрыто.
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting)
      reg.addEventListener('updatefound', onUpdateFound)
      // Проверяем сразу на старте. Установленное приложение с домашнего экрана — это как
      // раз холодный запуск без перезагрузки страницы, и без явной проверки обновление
      // ждало бы, пока браузер сам решит сходить за sw.js.
      void reg.update().catch(() => undefined)
    }

    // Регистрацию заводит next-pwa (workbox-window) на событии `load`, а этот эффект
    // выполняется РАНЬШЕ. Поэтому одного getRegistration() мало: на первом заходе он
    // отдаёт undefined, и раньше хук после этого молчал до конца жизни страницы —
    // ни updatefound, ни проверок по возвращении. Берём и то, что уже есть, и то, что
    // появится: `ready` разрешается, когда SW станет активным.
    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) attach(reg)
    })
    void navigator.serviceWorker.ready.then(attach).catch(() => undefined)

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Приложение с домашнего экрана живёт неделями и не перезагружается — сам браузер
    // проверяет обновление редко. Проверяем при каждом возвращении к приложению.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
      registration?.removeEventListener('updatefound', onUpdateFound)
    }
  }, [])

  return { version: BUILD_ID, state, check, apply }
}

/**
 * Страховка на случай, когда обновление уже не спросишь: старая страница просит чанк,
 * которого после деплоя нет. Перезагружаемся один раз за сессию — иначе при настоящей
 * поломке сборки получился бы цикл перезагрузок.
 */
export function useChunkErrorRecovery(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const isChunkError = (value: unknown): boolean => {
      const message =
        value instanceof Error ? `${value.name} ${value.message}` : String(value ?? '')
      return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module/i.test(
        message,
      )
    }

    const recover = (): void => {
      if (sessionStorage.getItem(RELOADED_KEY)) return
      sessionStorage.setItem(RELOADED_KEY, '1')
      window.location.reload()
    }

    const onError = (e: ErrorEvent): void => {
      if (isChunkError(e.error ?? e.message)) recover()
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      if (isChunkError(e.reason)) recover()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}
