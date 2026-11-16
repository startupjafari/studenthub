import { describe, expect, it } from 'vitest'
import { STICKER_LIMITS } from '@studenthub/shared-schemas'
import { reorderPatches, stickerFileProblem } from './sticker-set-admin'

describe('stickerFileProblem', () => {
  it('PNG, WebP и GIF до 512 КБ проходят', () => {
    for (const type of ['image/png', 'image/webp', 'image/gif']) {
      expect(stickerFileProblem({ type, size: 1024 })).toBeNull()
    }
    expect(stickerFileProblem({ type: 'image/png', size: STICKER_LIMITS.MAX_BYTES })).toBeNull()
  })

  it('чужой тип отбивается раньше размера', () => {
    expect(stickerFileProblem({ type: 'image/jpeg', size: 10 })).toBe('type')
    expect(stickerFileProblem({ type: '', size: 10 })).toBe('type')
    expect(stickerFileProblem({ type: 'image/svg+xml', size: 10 ** 7 })).toBe('type')
  })

  it('больше 512 КБ — size', () => {
    expect(stickerFileProblem({ type: 'image/gif', size: STICKER_LIMITS.MAX_BYTES + 1 })).toBe(
      'size',
    )
  })
})

describe('reorderPatches', () => {
  const sets = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
  ]

  it('поднять — меняются местами два соседа', () => {
    expect(reorderPatches(sets, 1, 0)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ])
  })

  it('опустить последний — нечего патчить', () => {
    expect(reorderPatches(sets, 2, 3)).toEqual([])
    expect(reorderPatches(sets, 0, -1)).toEqual([])
    expect(reorderPatches(sets, 1, 1)).toEqual([])
  })

  it('дыры и одинаковые order после удалений разводятся в 0…n−1', () => {
    const messy = [
      { id: 'a', order: 0 },
      { id: 'b', order: 0 },
      { id: 'c', order: 5 },
    ]
    expect(reorderPatches(messy, 2, 1)).toEqual([
      { id: 'c', order: 1 },
      { id: 'b', order: 2 },
    ])
  })
})
