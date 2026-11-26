'use client'

import { useSyncExternalStore } from 'react'
import { isNcaLayerPlatform } from './ncalayer-client'

const subscribe = () => () => undefined

/**
 * Можно ли на этом устройстве подписать через NCALayer. На сервере и при гидратации — `false`:
 * кнопка ЭЦП появляется уже после неё и не расходится с разметкой сервера.
 */
export function useNcaLayerSupported(): boolean {
  return useSyncExternalStore(subscribe, isNcaLayerPlatform, () => false)
}
