import { SUPPORTED_LOCALES } from '@studenthub/shared-config'
import { UpdateProfileSchema } from '@studenthub/shared-schemas'

// Список языков живёт в двух местах: SUPPORTED_LOCALES (shared-config) — то, что умеет
// платформа, и z.enum в UpdateProfileSchema — то, что принимает API. Импортировать один
// в другой нельзя: shared-schemas от shared-config не зависит, и заводить эту связь ради
// трёх строк не стали.
//
// Поэтому расхождение ловится здесь. Это единственное место, которое видит оба пакета, и
// цена молчаливого расхождения высокая: добавили язык в интерфейс, забыли в схеме — и
// человек выбирает язык, а сохранить его не может, причём ошибка приходит с валидации,
// то есть выглядит как баг формы.
describe('контракт языка', () => {
  const field = UpdateProfileSchema.shape.locale

  it('API принимает ровно те языки, что поддерживает платформа', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(field.safeParse(locale).success).toBe(true)
    }
  })

  it('и ничего кроме них', () => {
    for (const bad of ['de', 'ru-RU', 'RU', 'ру', '']) {
      expect(field.safeParse(bad).success).toBe(false)
    }
  })

  it('поле необязательное — профиль можно обновить, не трогая язык', () => {
    expect(field.safeParse(undefined).success).toBe(true)
  })
})
