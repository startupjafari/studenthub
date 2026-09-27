import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from './use-sw-update'

// Устаревшая вкладка просит кусок сборки, которого уже нет, — это лечится перезагрузкой.
// Главное здесь — узнать такую ошибку по любому из видов, в которых её сообщают браузеры
// и сам Next, и не спутать с настоящей поломкой, которую перезагрузка спрячет.
describe('isChunkLoadError', () => {
  it('узнаёт кусок App Router с именем маршрута, а не номером', () => {
    const error = new Error('Loading chunk app/(student)/profile/[id]/page failed.')
    error.name = 'ChunkLoadError'
    expect(isChunkLoadError(error)).toBe(true)
    expect(isChunkLoadError('Loading chunk app/(student)/profile/[id]/page failed.')).toBe(true)
  })

  it('узнаёт числовой кусок и CSS-кусок', () => {
    expect(isChunkLoadError(new Error('Loading chunk 123 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk 45 failed.'))).toBe(true)
  })

  it('узнаёт формулировки Safari и Firefox', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(
      isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /x.js')),
    ).toBe(true)
  })

  it('обычную ошибку за ошибку куска не принимает', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
