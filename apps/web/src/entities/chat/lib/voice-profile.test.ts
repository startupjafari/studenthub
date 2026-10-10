import { describe, expect, it } from 'vitest'
import {
  BAR_FLOOR,
  envelopeOf,
  normalizeEnvelope,
  resampleEnvelope,
  voiceBarCount,
} from './voice-profile'

describe('voiceBarCount', () => {
  it('ширина растёт с длительностью', () => {
    expect(voiceBarCount(1)).toBeLessThan(voiceBarCount(5))
    expect(voiceBarCount(5)).toBeLessThan(voiceBarCount(15))
  })

  it('упирается в потолок, а не растёт бесконечно', () => {
    expect(voiceBarCount(600)).toBe(voiceBarCount(60))
    expect(voiceBarCount(600)).toBeLessThanOrEqual(44)
  })

  it('без длительности — средняя ширина, между самой узкой и самой широкой', () => {
    const unknown = voiceBarCount(0)
    expect(unknown).toBeGreaterThan(voiceBarCount(1))
    expect(unknown).toBeLessThan(voiceBarCount(600))
    expect(voiceBarCount(Number.POSITIVE_INFINITY)).toBe(unknown)
    expect(voiceBarCount(Number.NaN)).toBe(unknown)
  })
})

describe('envelopeOf', () => {
  it('считает громкость по отрезкам записи', () => {
    const samples = new Float32Array([1, 1, 1, 1, 0, 0, 0, 0])
    expect(envelopeOf(samples, 2)).toEqual([1, 0])
  })

  it('тихая половина ниже громкой', () => {
    const samples = new Float32Array(1000)
    for (let i = 0; i < 500; i++) samples[i] = 0.8
    for (let i = 500; i < 1000; i++) samples[i] = 0.05
    const [loud, quiet] = envelopeOf(samples, 2)
    expect(loud).toBeGreaterThan(quiet! * 10)
  })

  it('пустая запись не роняет расчёт', () => {
    expect(envelopeOf(new Float32Array(0), 4)).toEqual([0, 0, 0, 0])
  })
})

describe('normalizeEnvelope', () => {
  it('одиночный щелчок не прижимает речь к полу', () => {
    // 99 отрезков обычной речи и один стук по столу в 25 раз громче: нормировка по
    // максимуму оставила бы от речи 4% высоты, и волна выглядела бы как ровная нить.
    const envelope = [...new Array<number>(99).fill(0.2), 5]
    const out = normalizeEnvelope(envelope)
    expect(out[0]).toBe(1)
    expect(out[99]).toBe(1)
  })

  it('тишина — ровная нить, а не усиленный до потолка шум', () => {
    expect(normalizeEnvelope(new Array<number>(8).fill(0))).toEqual(
      new Array<number>(8).fill(BAR_FLOOR),
    )
    expect(normalizeEnvelope(new Array<number>(8).fill(1e-6))).toEqual(
      new Array<number>(8).fill(BAR_FLOOR),
    )
  })

  it('держит значения в 0..1 и не опускается ниже пола', () => {
    const out = normalizeEnvelope([0, 0.01, 0.5, 1, 2])
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(BAR_FLOOR)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('resampleEnvelope', () => {
  it('отдаёт ровно столько полос, сколько просят', () => {
    expect(resampleEnvelope(new Array<number>(128).fill(0.5), 22)).toHaveLength(22)
    expect(resampleEnvelope(new Array<number>(128).fill(0.5), 44)).toHaveLength(44)
  })

  it('берёт по отрезку максимум — паузы между словами не замыливаются', () => {
    // Усреднение дало бы 0.5 и 0.25: всплеск в первом отрезке стал бы неотличим от второго.
    expect(resampleEnvelope([1, 0, 0.5, 0], 2)).toEqual([1, 0.5])
  })

  it('пустой отрезок рисуется полом, а не нулём', () => {
    expect(resampleEnvelope([0, 0], 2)).toEqual([BAR_FLOOR, BAR_FLOOR])
  })

  it('пустая огибающая не роняет расчёт', () => {
    expect(resampleEnvelope([], 10)).toEqual([])
    expect(resampleEnvelope([1], 0)).toEqual([])
  })
})
