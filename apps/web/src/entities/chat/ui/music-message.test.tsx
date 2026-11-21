import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

import { formatTrackTime, MusicMessage, trackTitle } from './music-message'

describe('formatTrackTime', () => {
  it('минуты и часы', () => {
    expect(formatTrackTime(8.05)).toBe('0:08')
    expect(formatTrackTime(185)).toBe('3:05')
    expect(formatTrackTime(3750)).toBe('1:02:30')
    expect(formatTrackTime(Number.NaN)).toBe('0:00')
  })
})

describe('trackTitle', () => {
  it('имя файла без расширения', () => {
    expect(trackTitle('Подкаст выпуск 4.mp3')).toBe('Подкаст выпуск 4')
    expect(trackTitle('Аудиокнига, глава 1.m4b')).toBe('Аудиокнига, глава 1')
    expect(trackTitle('без расширения')).toBe('без расширения')
    expect(trackTitle(null)).toBe('')
  })
})

describe('MusicMessage', () => {
  // Строка песни видна сразу — ссылка на файл для неё не нужна (пузырь не меняет размер).
  it('без ссылки показывает название, длительность и вес', () => {
    render(
      <MusicMessage
        seed="a1"
        name="Подкаст выпуск 4.mp3"
        size={64618}
        durationMs={8046}
        mine={false}
      />,
    )
    expect(screen.getByText('Подкаст выпуск 4')).toBeTruthy()
    expect(screen.getByText(/0:08 ·/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'play' })).toBeTruthy()
  })
})
