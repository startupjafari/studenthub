'use client'

import { useTheme } from 'next-themes'
import { chartPalette, type ChartPalette } from '../model/palette'

// Цвета графиков зависят от активной темы: тёмные шаги палитры выбраны под тёмную
// поверхность, автоматическая «инверсия» светлых здесь не годится.
// До гидратации resolvedTheme пуст — берём светлую, иначе на сервере и на клиенте
// получится разная разметка.
export function useChartTheme(): { palette: ChartPalette; dark: boolean } {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return { palette: chartPalette(dark), dark }
}
