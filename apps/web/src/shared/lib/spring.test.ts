import { describe, expect, it } from 'vitest'
import { projectMomentum, rubberband, velocityFrom } from './spring'

// Сама пружина (createSpring) держится на requestAnimationFrame и проверяется глазами в
// браузере; здесь зафиксированы чистые функции физики жеста — их легко сломать «упрощением».

describe('projectMomentum', () => {
  it('покой никуда не проецируется', () => {
    expect(projectMomentum(0)).toBe(0)
  })

  it('знак сохраняется — бросок вверх проецируется вверх', () => {
    expect(projectMomentum(-800)).toBeLessThan(0)
    expect(projectMomentum(800)).toBeGreaterThan(0)
  })

  it('быстрый бросок улетает дальше медленного', () => {
    expect(projectMomentum(1200)).toBeGreaterThan(projectMomentum(400))
  })

  it('это экспоненциальное затухание, а не v²/2a: путь линеен по скорости', () => {
    // Вдвое быстрее — ровно вдвое дальше. У школьной формулы было бы вчетверо, и флик
    // ощущался бы непредсказуемо резким.
    expect(projectMomentum(1000)).toBeCloseTo(projectMomentum(500) * 2, 5)
  })

  it('более резкое замедление укорачивает проекцию', () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000, 0.998))
  })
})

describe('rubberband', () => {
  it('на границе сопротивления нет', () => {
    expect(rubberband(0, 400)).toBe(0)
  })

  it('за границей элемент отстаёт от пальца', () => {
    expect(rubberband(100, 400)).toBeLessThan(100)
  })

  it('сопротивление нарастает: чем дальше тянут, тем меньше отдача на тот же путь', () => {
    const firstHundred = rubberband(100, 400)
    const secondHundred = rubberband(200, 400) - firstHundred
    expect(secondHundred).toBeLessThan(firstHundred)
  })

  it('асимптота вместо жёсткого стопа: смещение растёт, но ограничено', () => {
    // Даже утащив палец на километр, элемент не уезжает дальше ~dimension/constant.
    expect(rubberband(100_000, 400)).toBeLessThan(400 / 0.55)
    // При этом он всё-таки продолжает двигаться — это и отличает резину от «заело».
    expect(rubberband(100_000, 400)).toBeGreaterThan(rubberband(1_000, 400))
  })

  it('симметрична по направлению', () => {
    expect(rubberband(-100, 400)).toBeCloseTo(-rubberband(100, 400), 10)
  })
})

describe('velocityFrom', () => {
  it('одной точки мало — скорости нет', () => {
    expect(velocityFrom([{ position: 10, time: 0 }])).toBe(0)
  })

  it('переводит px/мс в px/с', () => {
    const v = velocityFrom([
      { position: 0, time: 0 },
      { position: 50, time: 50 },
    ])
    expect(v).toBeCloseTo(1000, 5)
  })

  it('знак показывает направление', () => {
    const v = velocityFrom([
      { position: 100, time: 0 },
      { position: 0, time: 50 },
    ])
    expect(v).toBeLessThan(0)
  })

  it('старые точки не размазывают резкое движение в конце жеста', () => {
    // Палец долго стоял, потом рванул. Скорость должна отражать рывок, а не среднее
    // по всему жесту — иначе флик после паузы не срабатывает.
    const v = velocityFrom([
      { position: 0, time: 0 },
      { position: 0, time: 500 },
      { position: 60, time: 560 },
    ])
    expect(v).toBeCloseTo(1000, 0)
  })

  it('нулевой интервал не даёт деления на ноль', () => {
    const v = velocityFrom([
      { position: 0, time: 42 },
      { position: 10, time: 42 },
    ])
    expect(v).toBe(0)
  })
})
