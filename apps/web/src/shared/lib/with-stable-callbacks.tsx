'use client'

import { memo, useRef, type ComponentType } from 'react'

type AnyFn = (...args: never[]) => unknown

/**
 * Обёртка над компонентом с кучей обработчиков, которые родитель создаёт заново каждым
 * рендером (стрелки прямо в JSX). Обычный `memo` с такими props бесполезен: функции всегда
 * новые. Здесь каждая функция-prop подменяется постоянной прокладкой, которая зовёт свежую
 * версию из последнего рендера, — и `memo` пропускает рендер, пока не поменялись данные.
 *
 * Только для обработчиков событий и колбэков, которые вызываются после рендера. Функция,
 * которую ребёнок зовёт прямо во время своего рендера (render-prop), получит версию из
 * текущего рендера родителя — ref обновляется до рендера ребёнка, так что и это безопасно.
 */
export function withStableCallbacks<P extends object>(Inner: ComponentType<P>): ComponentType<P> {
  const Memo = memo(Inner) as unknown as ComponentType<P>
  function StableCallbacks(props: P) {
    // Последние props пишем во время рендера, как msgHandlersRef в ленте чата: прокладки
    // зовутся из обработчиков, то есть уже после этого рендера.
    const latest = useRef(props)
    latest.current = props
    const proxies = useRef(new Map<string, AnyFn>())
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      if (typeof value !== 'function') {
        next[key] = value
        continue
      }
      let proxy = proxies.current.get(key)
      if (!proxy) {
        proxy = (...args: never[]) =>
          (latest.current as Record<string, AnyFn | undefined>)[key]?.(...args)
        proxies.current.set(key, proxy)
      }
      next[key] = proxy
    }
    return <Memo {...(next as P)} />
  }
  StableCallbacks.displayName = `StableCallbacks(${Inner.displayName ?? Inner.name})`
  return StableCallbacks
}
