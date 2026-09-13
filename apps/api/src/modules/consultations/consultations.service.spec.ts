import { slotOrderBy } from './consultations.service'

// Порядок строк таблицы — то место, где ошибка не видна на экране: список выглядит
// упорядоченным в любом случае, а страницы при этом могут перемешиваться.
describe('slotOrderBy', () => {
  it('по времени — единственный ключ: он уникален сам по себе', () => {
    expect(slotOrderBy('startsAt', 'desc')).toEqual([{ startsAt: 'desc' }])
  })

  it('по статусу — вторым ключом время, иначе порядок страниц непредсказуем', () => {
    // Статусов три на сотню слотов: без второго ключа СУБД вправе вернуть строки с
    // одинаковым статусом в любом порядке, и одна и та же запись попадала бы то на
    // первую страницу, то на вторую.
    expect(slotOrderBy('status', 'asc')).toEqual([{ status: 'asc' }, { startsAt: 'asc' }])
  })

  it('по студенту — по фамилии и имени, а не по studentId', () => {
    // studentId это uuid: сортировка по нему дала бы случайный порядок, выглядящий
    // как осмысленный.
    expect(slotOrderBy('student', 'asc')).toEqual([
      { student: { lastName: 'asc' } },
      { student: { firstName: 'asc' } },
      { startsAt: 'asc' },
    ])
  })

  it('направление применяется ко всем ключам имени, но не к запасному времени', () => {
    const order = slotOrderBy('student', 'desc')
    expect(order[0]).toEqual({ student: { lastName: 'desc' } })
    // Запасной ключ всегда возрастающий: он не про выбор пользователя, а про
    // устойчивость порядка между страницами.
    expect(order[order.length - 1]).toEqual({ startsAt: 'asc' })
  })
})
