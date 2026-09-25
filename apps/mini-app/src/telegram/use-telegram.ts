import { useEffect, useRef } from 'react'
import { webApp } from './webapp'

// Хуки над нативными кнопками Telegram.
//
// Зачем вообще нативные кнопки: MainButton нарисован клиентом ПОД областью мини-аппа и
// не отнимает у неё высоту, а BackButton живёт в шапке рядом с «Закрыть».
//
// Своя кнопка возврата в шапке экрана (ui/screen-header.tsx) при этом ЕСТЬ, хотя раньше
// здесь было записано обратное: кнопка Telegram выглядит в каждом клиенте по-своему, а на
// части из них не появляется вовсе — и человек, провалившийся в карточку, выхода не видел.
// Две кнопки рядом лучше одной ненадёжной: обе делают одно и то же, и промахнуться нечем.
//
// Сложность ровно одна: `onClick` в Telegram не заменяет обработчик, а добавляет. Снимать
// старый обязательно, иначе после трёх переходов один тап вызовет три колбэка. Поэтому
// подписка живёт в эффекте с пустыми зависимостями, а свежий колбэк читается из ref —
// иначе каждое изменение пропса переподписывало бы кнопку.

function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/**
 * Кнопка «Назад» в шапке. `onBack === null` — экран верхнего уровня, кнопка скрыта.
 */
export function useBackButton(onBack: (() => void) | null): void {
  const handler = useLatest(onBack)

  useEffect(() => {
    const tg = webApp()
    if (!tg) return

    const click = (): void => handler.current?.()
    tg.BackButton.onClick(click)
    return () => tg.BackButton.offClick(click)
  }, [handler])

  useEffect(() => {
    const tg = webApp()
    if (!tg) return
    if (onBack) tg.BackButton.show()
    else tg.BackButton.hide()
  }, [onBack])
}

/**
 * Главная кнопка внизу. `text === null` — кнопка не нужна на этом экране.
 */
export function useMainButton(text: string | null, onClick: () => void): void {
  const handler = useLatest(onClick)

  useEffect(() => {
    const tg = webApp()
    if (!tg) return

    const click = (): void => handler.current()
    tg.MainButton.onClick(click)
    return () => {
      tg.MainButton.offClick(click)
      tg.MainButton.hide()
    }
  }, [handler])

  useEffect(() => {
    const tg = webApp()
    if (!tg) return
    if (text) {
      tg.MainButton.setText(text)
      tg.MainButton.show()
    } else {
      tg.MainButton.hide()
    }
  }, [text])
}
