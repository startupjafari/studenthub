'use client'

import { useSyncExternalStore } from 'react'

import { isIosDevice, isStandalonePwa } from './platform'

/**
 * Установка приложения на главный экран.
 *
 * Chromium (Chrome, Edge, Samsung Internet, Chrome на Android) присылает
 * `beforeinstallprompt`, когда сайт проходит критерии установки: манифест с иконками
 * и `display: standalone`, зарегистрированный service worker, https. Событие нужно
 * перехватить и погасить — тогда браузер не покажет свою плашку, а мы вызовем
 * `prompt()` из кнопки в настройках.
 *
 * Слушатель ставится на уровне модуля, а не в компоненте: событие прилетает почти
 * сразу после загрузки страницы, задолго до того, как человек откроет настройки.
 * Подпишись мы в `useEffect` — событие было бы уже упущено, а второй раз браузер его
 * не пришлёт до следующего захода. Поэтому модуль импортируется в `AppProviders`.
 *
 * Safari (iOS, iPadOS, macOS) такого события не имеет и программной установки не даёт
 * вовсе: добавить на главный экран можно только руками через «Поделиться». Firefox на
 * десктопе не устанавливает приложения совсем. Для них кнопка показывает инструкцию.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaInstallStatus =
  /** Уже открыто как приложение (standalone) — устанавливать нечего. */
  | 'installed'
  /** Браузер дал событие установки: сработает системное окно. */
  | 'ready'
  /** Программной установки нет (Safari, Firefox) — показываем инструкцию. */
  | 'manual'

export type PwaPlatform = 'ios' | 'macos-safari' | 'other'

export interface PwaInstallState {
  status: PwaInstallStatus
  platform: PwaPlatform
}

let deferred: BeforeInstallPromptEvent | null = null
let snapshot: PwaInstallState = { status: 'manual', platform: 'other' }
const listeners = new Set<() => void>()

// Снимок пересоздаём только при реальном изменении: useSyncExternalStore сравнивает
// его по ссылке и уходит в бесконечный рендер, если возвращать новый объект каждый раз.
function publish(next: Partial<PwaInstallState>): void {
  const merged = { ...snapshot, ...next }
  if (merged.status === snapshot.status && merged.platform === snapshot.platform) return
  snapshot = merged
  listeners.forEach((l) => l())
}

function detectPlatform(): PwaPlatform {
  if (isIosDevice()) return 'ios'
  const ua = navigator.userAgent
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua)
  return safari ? 'macos-safari' : 'other'
}

// matchMedia есть не везде: старые вебвью и jsdom в тестах его не реализуют, а модуль
// выполняется при импорте — падение здесь уронило бы всё, что тянет shared/lib.
function standaloneQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)')
    : null
}

if (typeof window !== 'undefined') {
  snapshot = {
    status: isStandalonePwa() ? 'installed' : 'manual',
    platform: detectPlatform(),
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    publish({ status: 'ready' })
  })

  // Установили — из браузерного меню или нашей кнопкой: убираем предложение.
  window.addEventListener('appinstalled', () => {
    deferred = null
    publish({ status: 'installed' })
  })

  // Приложение могли открыть из ярлыка в уже загруженной вкладке (или наоборот).
  standaloneQuery()?.addEventListener('change', (e) =>
    publish({ status: e.matches ? 'installed' : 'manual' }),
  )
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

// На сервере установки нет и быть не может: отдаём константу, иначе гидрация разойдётся.
const SERVER_STATE: PwaInstallState = { status: 'manual', platform: 'other' }

/**
 * Вызов системного окна установки. Возвращает `unavailable`, если события не было —
 * тогда вызывающий показывает инструкцию.
 *
 * Событие одноразовое: после `prompt()` этот же объект больше не сработает. Chrome
 * пришлёт новый `beforeinstallprompt` при следующем заходе, если установку отклонили.
 */
export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'dismissed') publish({ status: 'manual' })
  return outcome
}

export function usePwaInstall(): PwaInstallState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_STATE,
  )
}
