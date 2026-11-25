import { describe, expect, it } from 'vitest'
import {
  MAX_POST_MEDIA,
  moveItem,
  pickAcceptable,
  readyMediaIds,
  type ComposerMedia,
} from './media-queue'

const file = (name: string, type: string, size = 100): File =>
  new File([new Uint8Array(size)], name, { type })
const limit = () => 1000

function item(key: string, status: ComposerMedia['status'], fileId?: string): ComposerMedia {
  return {
    key,
    file: file(`${key}.jpg`, 'image/jpeg'),
    previewUrl: `blob:${key}`,
    isVideo: false,
    status,
    progress: status === 'done' ? 100 : 0,
    fileId,
  }
}

describe('moveItem', () => {
  it('переставляет вперёд и назад, остальной порядок не трогает', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('край за пределами списка — к ближайшему краю, неверный источник — без изменений', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 10)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c'])
  })
})

describe('readyMediaIds', () => {
  it('отдаёт id загруженных ровно в порядке редактора, пропуская незагруженные', () => {
    const items = [
      item('k3', 'done', 'f3'),
      item('k1', 'uploading'),
      item('k2', 'done', 'f2'),
      item('k4', 'error'),
      item('k5', 'done', 'f5'),
    ]
    expect(readyMediaIds(items)).toEqual(['f3', 'f2', 'f5'])
  })
})

describe('pickAcceptable', () => {
  it('документы и прочее отклоняет по типу, крупное — по размеру', () => {
    const { accepted, rejected } = pickAcceptable(
      [
        file('a.pdf', 'application/pdf'),
        file('b.jpg', 'image/jpeg', 5000),
        file('c.mp4', 'video/mp4'),
      ],
      0,
      limit,
    )
    expect(accepted.map((f) => f.name)).toEqual(['c.mp4'])
    expect([...rejected].sort()).toEqual(['size', 'type'])
  })

  it('сверх лимита вложений не берёт и сообщает причину', () => {
    const files = Array.from({ length: 4 }, (_, i) => file(`${i}.png`, 'image/png'))
    const { accepted, rejected } = pickAcceptable(files, MAX_POST_MEDIA - 2, limit)
    expect(accepted).toHaveLength(2)
    expect(rejected.has('limit')).toBe(true)
  })
})
