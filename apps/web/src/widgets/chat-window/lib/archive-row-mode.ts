'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Вид строки «Архив» над списком «Все» — как в Telegram:
 *  · `expanded` — строка в рост чата с названиями архивных чатов;
 *  · `collapsed` — узкая полоска «Архив» со счётчиком;
 *  · `hidden` — строки нет, архив открывается из меню списка.
 *
 * Выбор — удобство одного человека на одном устройстве, не данные сессии: localStorage здесь
 * уместен (FRONTEND_RULES §1 запрещает там только токены и данные сессии). Хранилище может
 * быть закрыто (приватный режим) — тогда просто вид по умолчанию.
 */
export type ArchiveRowMode = 'expanded' | 'collapsed' | 'hidden'

const STORAGE_KEY = 'sh.chats.archiveRow'
const MODES: readonly ArchiveRowMode[] = ['expanded', 'collapsed', 'hidden']

export function readArchiveRowMode(): ArchiveRowMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return MODES.includes(raw as ArchiveRowMode) ? (raw as ArchiveRowMode) : 'expanded'
  } catch {
    return 'expanded'
  }
}

function writeArchiveRowMode(mode: ArchiveRowMode): void {
  try {
    if (mode === 'expanded') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Не запомнилось — на этом устройстве вид вернётся к умолчанию, работе это не мешает.
  }
}

export function useArchiveRowMode(): [ArchiveRowMode, (mode: ArchiveRowMode) => void] {
  // До чтения хранилища — умолчание: на сервере его нет, и разметка должна совпасть.
  const [mode, setModeState] = useState<ArchiveRowMode>('expanded')
  useEffect(() => {
    setModeState(readArchiveRowMode())
  }, [])
  const setMode = useCallback((next: ArchiveRowMode): void => {
    setModeState(next)
    writeArchiveRowMode(next)
  }, [])
  return [mode, setMode]
}
