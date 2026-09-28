import { useEffect, useRef } from 'react'
import { webApp } from './webapp'
import type { TelegramMainButton, TelegramWebApp } from './types'

// Хуки над нативными кнопками Telegram.
//
// Зачем вообще нативные кнопки: MainButton нарисован клиентом ПОД областью мини-аппа и
// не отнимает у неё высоту, а BackButton живёт в шапке рядом с «Закрыть».
//
// Своей кнопки возврата в шапке экрана нет: две двери из одного экрана читаются как два
// разных действия, а в мини-аппе наша стрелка вдобавок вставала прямо под стрелкой самого
// Telegram. Возврат один, и живёт он здесь.
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
 * Кнопка «Назад» в шапке клиента. `onBack === null` — кнопки нет.
 *
 * Зовётся один раз, из самого приложения: кнопка видна на всех экранах, а решение «назад
 * или наружу» принимает стек возврата (lib/back.ts). Пока её показывал каждый экран сам,
 * на верхних она пропадала — вместе с единственным видимым выходом.
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

/** Вид нижней кнопки. `destructive` — цвет разрушительного действия из темы клиента. */
export interface BottomButtonOptions {
  tone?: 'default' | 'destructive'
  /** Запрос в пути: крутилка на кнопке, повторное нажатие не проходит. */
  busy?: boolean
  disabled?: boolean
}

type ButtonPick = (tg: TelegramWebApp) => TelegramMainButton | undefined

/**
 * Общая механика главной и второстепенной кнопок: подписка один раз, свежий колбэк из
 * ref, вид — отдельным эффектом. Второстепенной нет у старых клиентов — тогда хук молчит,
 * а экран рисует свои кнопки (`hasBottomButtons`).
 */
function useBottomButton(
  pick: ButtonPick,
  text: string | null,
  onClick: () => void,
  options: BottomButtonOptions & { position?: 'left' | 'right' | 'top' | 'bottom' },
): void {
  const handler = useLatest(onClick)
  const pickRef = useLatest(pick)
  const { tone = 'default', busy = false, disabled = false, position } = options

  useEffect(() => {
    const tg = webApp()
    const button = tg ? pickRef.current(tg) : undefined
    if (!button) return

    const click = (): void => handler.current()
    button.onClick(click)
    return () => {
      button.offClick(click)
      button.hideProgress?.()
      button.hide()
    }
  }, [handler, pickRef])

  useEffect(() => {
    const tg = webApp()
    const button = tg ? pickRef.current(tg) : undefined
    if (!tg || !button) return
    if (!text) {
      button.hide()
      return
    }
    if (button.setParams) {
      const destructive = tone === 'destructive'
      button.setParams({
        text,
        is_visible: true,
        is_active: !disabled && !busy,
        // Красная кнопка — цветом разрушительного действия клиента, а не своим красным:
        // в тёмной теме он другой, и свой выглядел бы наклейкой.
        ...(destructive
          ? { color: tg.themeParams.destructive_text_color ?? '#df3f40', text_color: '#ffffff' }
          : {}),
        ...(position ? { position } : {}),
      })
    } else {
      button.setText(text)
      if (disabled || busy) button.disable()
      else button.enable()
      button.show()
    }
    if (busy) button.showProgress?.(false)
    else button.hideProgress?.()
  }, [pickRef, text, tone, busy, disabled, position])
}

/**
 * Главная кнопка внизу. `text === null` — кнопка не нужна на этом экране.
 */
export function useMainButton(
  text: string | null,
  onClick: () => void,
  options: BottomButtonOptions = {},
): void {
  useBottomButton(pickMain, text, onClick, options)
}

/**
 * Вторая кнопка рядом с главной. Нужна там, где решений два равноправных: одна кнопка
 * заставляла выносить второе решение в поток экрана, подальше от пальца.
 */
export function useSecondaryButton(
  text: string | null,
  onClick: () => void,
  options: BottomButtonOptions & { position?: 'left' | 'right' | 'top' | 'bottom' } = {},
): void {
  useBottomButton(pickSecondary, text, onClick, options)
}

const pickMain: ButtonPick = (tg) => tg.MainButton
const pickSecondary: ButtonPick = (tg) => tg.SecondaryButton

/**
 * Пункт «Настройки» в меню «⋯» мини-аппа. `onOpen === null` — пункта нет.
 *
 * Настройки устройства (размер текста) живут там, а не во вкладке: их трогают раз в
 * полгода, и занимать ради них место на экране незачем — а меню «⋯» Telegram человек
 * и так открывает, когда ищет «как это настроить».
 */
export function useSettingsButton(onOpen: (() => void) | null): void {
  const handler = useLatest(onOpen)

  useEffect(() => {
    const button = webApp()?.SettingsButton
    if (!button) return
    const click = (): void => handler.current?.()
    button.onClick(click)
    return () => button.offClick(click)
  }, [handler])

  const enabled = onOpen !== null
  useEffect(() => {
    const button = webApp()?.SettingsButton
    if (!button) return
    if (enabled) button.show()
    else button.hide()
  }, [enabled])
}
