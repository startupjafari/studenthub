import type { FastifyRequest } from 'fastify'
import { clientVersionFrom } from './client-version'

const requestWith = (value: unknown): FastifyRequest =>
  ({ headers: { 'x-client-version': value } }) as unknown as FastifyRequest

describe('clientVersionFrom', () => {
  it('читает формат клиента как есть', () => {
    expect(clientVersionFrom(requestWith('ios/1.2.0+34'))).toBe('ios/1.2.0+34')
  })

  it('без заголовка возвращает undefined — это веб или curl', () => {
    expect(clientVersionFrom({ headers: {} } as unknown as FastifyRequest)).toBeUndefined()
  })

  // Главное: значение приходит снаружи. Перевод строки в логе позволил бы подделать
  // соседнюю строку, а длинный заголовок — засорить лог.
  it('вычищает переводы строк и прочие небезопасные символы', () => {
    expect(clientVersionFrom(requestWith('ios/1.0.0\n{"level":50}'))).toBe('ios/1.0.0level50')
  })

  it('обрезает слишком длинное значение', () => {
    expect(clientVersionFrom(requestWith('a'.repeat(200)))).toHaveLength(64)
  })

  it('из пустого после чистки значения делает undefined', () => {
    expect(clientVersionFrom(requestWith('«»'))).toBeUndefined()
  })

  it('берёт первое значение, если заголовок пришёл дважды', () => {
    expect(clientVersionFrom(requestWith(['ios/1.0.0', 'ios/9.9.9']))).toBe('ios/1.0.0')
  })
})
