import { describe, expect, it } from 'vitest'
import { parseQrTarget } from './qr-target'

const WEB = 'https://app.studenthub.kz'

describe('parseQrTarget', () => {
  it('вход на другом устройстве', () => {
    expect(parseQrTarget(`${WEB}/qr?t=3f1c2a`)).toEqual({
      kind: 'login',
      href: '/qr?t=3f1c2a',
      value: '3f1c2a',
    })
  })

  it('студенческий: токен кодируется заново, а не переносится сырым', () => {
    const token = 'aGVsbG8=.d29y+bGQ/'
    const target = parseQrTarget(`${WEB}/verify-id?t=${encodeURIComponent(token)}`)
    expect(target).toEqual({
      kind: 'studentId',
      href: `/verify-id?t=${encodeURIComponent(token)}`,
      value: token,
    })
  })

  it('самоотметка на паре', () => {
    expect(parseQrTarget(`${WEB}/checkin?t=abc.def`)?.kind).toBe('checkin')
  })

  it('ссылка с токеном без токена — не наш QR', () => {
    expect(parseQrTarget(`${WEB}/qr`)).toBeNull()
    expect(parseQrTarget(`${WEB}/verify-id?t=`)).toBeNull()
  })

  it('наклейка помещения', () => {
    expect(parseQrTarget(`${WEB}/r/ABCD2345`)).toEqual({
      kind: 'room',
      href: '/r/ABCD2345',
      value: 'ABCD2345',
    })
  })

  it('код помещения вне алфавита наклеек не принимается', () => {
    expect(parseQrTarget(`${WEB}/r/ABCD0OIL`)).toBeNull()
    expect(parseQrTarget(`${WEB}/r/ABC`)).toBeNull()
  })

  it('публичное резюме не путается с помещением', () => {
    expect(parseQrTarget(`${WEB}/r/resume/ivan-petrov`)).toEqual({
      kind: 'resume',
      href: '/r/resume/ivan-petrov',
      value: 'ivan-petrov',
    })
  })

  it('выданный документ', () => {
    expect(parseQrTarget(`${WEB}/verify/K7M2PQ9X`)?.href).toBe('/verify/K7M2PQ9X')
  })

  it('приглашение в чат переносит код ?k=, без него — не приглашение', () => {
    expect(parseQrTarget(`${WEB}/join-chat/c1?k=x y`)?.href).toBe('/join-chat/c1?k=x%20y')
    expect(parseQrTarget(`${WEB}/join-chat/c1`)).toBeNull()
  })

  it('домен не сверяется: справка печатается с APP_PUBLIC_URL', () => {
    expect(parseQrTarget('https://studenthub.kz/verify/K7M2PQ9X')?.kind).toBe('document')
  })

  it('хвостовой слэш и пробелы вокруг не мешают', () => {
    expect(parseQrTarget(`  ${WEB}/r/ABCD2345/ \n`)?.kind).toBe('room')
    expect(parseQrTarget(`${WEB}/c/ABCD2345`)).toEqual({
      kind: 'bookCopy',
      href: '/c/ABCD2345',
      value: 'ABCD2345',
    })
    expect(parseQrTarget(`${WEB}/c/abcd`)).toBeNull()
  })

  it('чужие ссылки и не-ссылки отклоняются', () => {
    expect(parseQrTarget('https://example.com/promo')).toBeNull()
    expect(parseQrTarget(`${WEB}/`)).toBeNull()
    expect(parseQrTarget(`${WEB}/settings`)).toBeNull()
    expect(parseQrTarget('WIFI:S:campus;T:WPA;P:secret;;')).toBeNull()
    expect(parseQrTarget('просто текст')).toBeNull()
  })

  it('не http(s) не открывается, даже с нашим путём', () => {
    expect(parseQrTarget('javascript:alert(1)//qr?t=x')).toBeNull()
    expect(parseQrTarget('studenthub://qr?t=x')).toBeNull()
  })

  it('лишние сегменты пути не проходят: переход собирается только из проверенных частей', () => {
    expect(parseQrTarget(`${WEB}/r/ABCD2345/extra`)).toBeNull()
    expect(parseQrTarget(`${WEB}/verify/a/..%2F..%2Fsettings`)).toBeNull()
  })
})
