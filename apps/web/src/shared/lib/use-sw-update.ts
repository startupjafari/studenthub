'use client'

import { useEffect, useRef } from 'react'
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

export function useServiceWorkerUpdate(): void {
  const t = useTranslations('Common')
  // Переводы в замыкании слушателей: держим в ref, чтобы не переподписываться на смене локали.
  const tRef = useRef(t)
  tRef.current = t

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

    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return
      registration = reg
      // Обновление могло установиться, пока страница была закрыта.
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting)
      reg.addEventListener('updatefound', onUpdateFound)
    })

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Приложение с домашнего экрана живёт неделями и не перезагружается — сам браузер
    // проверяет обновление редко. Проверяем при каждом возвращении к приложению.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
      registration?.removeEventListener('updatefound', onUpdateFound)
    }
  }, [])
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
