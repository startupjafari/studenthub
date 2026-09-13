import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// next-intl → возвращаем ключ как есть; next/link → простой <a> (без роутера).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import { NextPairCard } from './next-pair-card'
import type { DayPair } from '../lib/schedule-day'
import type { Pair } from '../../../entities/schedule'

function pair(o: Partial<Pair> = {}): Pair {
  return {
    id: 'p1',
    scheduleId: 's1',
    groupId: 'g1',
    subject: 'Math',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH',
    teacher: null,
    room: null,
    ...o,
  }
}

function dayPair(state: DayPair['state'], o: Partial<Pair> = {}): DayPair {
  return { pair: pair(o), state, change: null, isCurrent: state === 'now' }
}

describe('NextPairCard', () => {
  it('нет пары → осмысленный пустой стейт', () => {
    render(<NextPairCard dayPair={null} quickLinks={[]} />)
    expect(screen.getByText('noMorePairs')).toBeInTheDocument()
  })

  it('предстоящая пара → предмет, время и метка nextPair', () => {
    render(
      <NextPairCard
        dayPair={dayPair('normal', { subject: 'Физика', startTime: '09:00', endTime: '10:30' })}
        quickLinks={[]}
      />,
    )
    expect(screen.getByText('Физика')).toBeInTheDocument()
    expect(screen.getByText(/09:00/)).toBeInTheDocument()
    expect(screen.getByText('nextPair')).toBeInTheDocument()
  })

  it('идёт сейчас → метка nowOngoing', () => {
    render(<NextPairCard dayPair={dayPair('now')} quickLinks={[]} />)
    expect(screen.getByText('nowOngoing')).toBeInTheDocument()
  })
})
