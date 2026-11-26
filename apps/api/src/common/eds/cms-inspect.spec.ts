import {
  AUTH_RSA_CERT,
  EKU,
  GOST2015_CERT,
  SIGN_RSA_CERT,
  ber,
  cms,
  der,
  extKeyUsageExtension,
} from './__testing__/cms-fixtures'
import { CmsFormatError, inspectCms } from './cms-inspect'

describe('inspectCms', () => {
  it('открепленная подпись в DER', () => {
    expect(inspectCms(cms())).toMatchObject({ detached: true, signerCount: 1 })
  })

  // Так подпись отдаёт NCALayer: длины indefinite, base64 начинается с «MIAGCSqGSIb3DQEHAqCA».
  it('открепленная подпись с indefinite-длинами', () => {
    const signature = cms({ indefinite: true })

    expect(signature.toString('base64').startsWith('MIAGCSqGSIb3DQEHAqCA')).toBe(true)
    expect(inspectCms(signature)).toMatchObject({ detached: true, signerCount: 1 })
  })

  // Ради этого разбор и существует: у присоединённой подписи NCANode проверяет вложенное,
  // а не присланные данные.
  it.each([false, true])('присоединённая подпись (indefinite: %s)', (indefinite) => {
    const signature = cms({ attached: Buffer.from('чужой документ'), indefinite })

    expect(inspectCms(signature).detached).toBe(false)
  })

  it('присоединённая подпись с пустым содержимым — всё равно присоединённая', () => {
    expect(inspectCms(cms({ attached: Buffer.alloc(0) })).detached).toBe(false)
  })

  it('считает подписантов', () => {
    expect(inspectCms(cms({ signers: 2 })).signerCount).toBe(2)
  })

  it.each([
    ['ключ аутентификации старой пары', AUTH_RSA_CERT, [true, false, true, true]],
    ['единый ключ ГОСТ 2015', GOST2015_CERT, [true, true, true, false]],
    ['ключ только подписи', SIGN_RSA_CERT, [true, true, false, false]],
  ])('назначение ключа: %s', (_, spec, [ds, nr, ke, clientAuth]) => {
    const [certificate] = inspectCms(cms({ certificates: [spec] })).certificates

    expect(certificate).toEqual({
      serialHex: expect.any(String),
      digitalSignature: ds,
      nonRepudiation: nr,
      keyEncipherment: ke,
      clientAuth,
    })
  })

  // NCANode пишет серийный номер через BigInteger.toString(16): нижний регистр, без нулей слева.
  it('серийный номер — как у NCANode', () => {
    const [certificate] = inspectCms(cms({ certificates: [GOST2015_CERT] })).certificates

    expect(certificate?.serialHex).toBe('ff06211dc82beb00253ffa000f1de84abef454f')
  })

  it('сертификат без расширений — ни одного назначения', () => {
    const [certificate] = inspectCms(cms({ certificates: [{ serial: '01' }] })).certificates

    expect(certificate).toMatchObject({ digitalSignature: false, clientAuth: false })
  })

  describe('отклоняет то, что не разобрал', () => {
    const valid = cms()

    it.each([
      ['пусто', Buffer.alloc(0)],
      ['обрыв', valid.subarray(0, valid.length - 10)],
      ['хвост после подписи', Buffer.concat([valid, Buffer.from([0])])],
      ['не SignedData', der(0x30, der(0x06, Buffer.from('2a864886f70d010701', 'hex')))],
      ['не последовательность', der(0x04, Buffer.from('abc'))],
      ['indefinite без конца', ber(0x30).subarray(0, 2)],
      ['indefinite у примитивного типа', Buffer.from('04800000', 'hex')],
      ['длина за пределами', Buffer.from('3084ffffffff', 'hex')],
    ])('%s', (_, input) => {
      expect(() => inspectCms(input)).toThrow(CmsFormatError)
    })

    // Присланная «матрёшка» из indefinite-длин не должна уронить процесс переполнением стека.
    it('слишком глубокая вложенность', () => {
      let nested: Buffer = Buffer.alloc(0)
      for (let i = 0; i < 1000; i++) nested = ber(0x30, nested)

      expect(() => inspectCms(nested)).toThrow(CmsFormatError)
    })

    // Какое из двух extKeyUsage прочитал бы Kalkan — неизвестно; гадать не беремся.
    it('повтор расширения сертификата', () => {
      const signature = cms({
        certificates: [
          {
            serial: '01',
            extKeyUsage: [EKU.emailProtection],
            extraExtensions: [extKeyUsageExtension([EKU.clientAuth])],
          },
        ],
      })

      expect(() => inspectCms(signature)).toThrow(CmsFormatError)
    })
  })
})
