import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../exceptions/app.exception'
import { AUTH_RSA_CERT, GOST2015_CERT, SIGN_RSA_CERT, cms } from './__testing__/cms-fixtures'
import { NcaNodeEdsVerifier } from './ncanode-eds-verifier'

const DAY = 86_400_000
const NONCE = Buffer.from('6b1f0c3e9a8d4b27a5e1f3c8d9b0a7e6', 'hex')
// ИИН и БИН тестовых сертификатов НУЦ из SDK.
const IIN = '123456789011'
const BIN = '123456789021'
const GOST_SERIAL = 'ff06211dc82beb00253ffa000f1de84abef454f'
const ISSUER = 'ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (GOST) TEST 2022'

type Json = Record<string, unknown>

/** Дата так, как её отдаёт Jackson в NCANode: «2026-11-26T07:00:00.000+00:00». */
const jacksonDate = (offsetMs: number): string =>
  new Date(Date.now() + offsetMs).toISOString().replace('Z', '+00:00')

/**
 * Ответ `POST /cms/verify` NCANode 3.5 (CmsVerificationResponse → CmsSignerInfo →
 * CertificateInfo) для одного подписанта с действующим единым ключом ГОСТ 2015. Поля без
 * значения NCANode опускает (@JsonInclude NON_NULL), кроме CertificateRevocationStatus.
 */
function ncaResponse(patch: { root?: Json; signer?: Json; cert?: Json; subject?: Json } = {}) {
  return {
    status: 200,
    message: 'OK',
    valid: true,
    signers: [
      {
        certificates: [
          {
            valid: true,
            revocations: [{ revoked: false, by: 'OCSP', revocationTime: null, reason: 'OK' }],
            notBefore: jacksonDate(-30 * DAY),
            notAfter: jacksonDate(335 * DAY),
            // Единый ключ у NCANode выходит SIGN: AUTH он ставит лишь без nonRepudiation.
            keyUsage: 'SIGN',
            serialNumber: GOST_SERIAL,
            signAlg: 'ECGOST3410-2015-512',
            keyUser: ['INDIVIDUAL'],
            publicKey: 'MIGsMCMGCSqDDgMKAQECAjAWBgoqgw4DCgEBAgIBBggqgw4DCgEDAwOBhAAE',
            signature: 'q83vEjRWeJA=',
            subject: {
              commonName: 'ТЕСТОВ ТЕСТ',
              surName: 'ТЕСТОВ',
              lastName: 'ТЕСТОВИЧ',
              iin: IIN,
              country: 'KZ',
              dn: `CN=ТЕСТОВ ТЕСТ, SURNAME=ТЕСТОВ, SERIALNUMBER=IIN${IIN}, C=KZ, G=ТЕСТОВИЧ`,
              ...patch.subject,
            },
            issuer: { commonName: ISSUER, country: 'KZ', dn: `CN=${ISSUER}, C=KZ` },
            ...patch.cert,
          },
        ],
        adesLevel: 'B',
        bestSignatureTime: jacksonDate(0),
        status: 'VALID',
        message: 'OK',
        ...patch.signer,
      },
    ],
    ...patch.root,
  }
}

const defaults = {
  EDS_LOGIN_ENABLED: true,
  NCANODE_URL: 'http://ncanode:14579',
  NCANODE_TIMEOUT_MS: 15_000,
  EDS_REVOCATION_CHECK: 'OCSP',
}

function verifier(env: Partial<Record<keyof typeof defaults, unknown>> = {}) {
  const values: Record<string, unknown> = { ...defaults, ...env }
  const config = { get: jest.fn((key: string) => values[key]) }
  return new NcaNodeEdsVerifier(config as unknown as ConfigService<EnvVars, true>)
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppException)
  return (error as AppException).code
}

describe('NcaNodeEdsVerifier', () => {
  const realFetch = global.fetch
  let fetchMock: jest.Mock
  let logs: string[]

  const reply = (body: unknown, status = 200): void => {
    fetchMock.mockResolvedValueOnce({ status, json: async () => body })
  }
  const signature = (spec?: Parameters<typeof cms>[0]): string => cms(spec).toString('base64')

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as never
    logs = []
    const collect = (message: unknown): void => {
      logs.push(String(message))
    }
    jest.spyOn(Logger.prototype, 'log').mockImplementation(collect)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(collect)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(collect)
  })
  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  describe('подпись принята', () => {
    it('физлицо с единым ключом ГОСТ 2015', async () => {
      reply(ncaResponse())

      const signer = await verifier().verifyAuthSignature(signature(), NONCE)

      expect(signer).toEqual({
        iin: IIN,
        orgBin: null,
        subjectCn: 'ТЕСТОВ ТЕСТ',
        certSerial: GOST_SERIAL,
        certIssuer: ISSUER,
        certNotBefore: expect.any(Date),
        certNotAfter: expect.any(Date),
      })
      expect(signer.certNotAfter.getTime()).toBeGreaterThan(Date.now())
    })

    it('ключ аутентификации старой пары (AUTH_RSA, clientAuth)', async () => {
      reply(ncaResponse({ cert: { keyUsage: 'AUTH', serialNumber: AUTH_RSA_CERT.serial } }))

      const signer = await verifier().verifyAuthSignature(
        signature({ certificates: [AUTH_RSA_CERT] }),
        NONCE,
      )

      expect(signer.iin).toBe(IIN)
    })

    it('сотрудник юрлица — БИН организации', async () => {
      reply(
        ncaResponse({
          subject: { bin: BIN, organization: 'АО "ТЕСТ"' },
          cert: { keyUser: ['ORGANIZATION', 'CEO'] },
        }),
      )

      const signer = await verifier().verifyAuthSignature(signature(), NONCE)

      expect(signer).toMatchObject({ iin: IIN, orgBin: BIN })
    })

    it('проверка отзыва по CRL', async () => {
      reply(
        ncaResponse({
          cert: {
            revocations: [{ revoked: false, by: 'CRL', revocationTime: null, reason: null }],
          },
        }),
      )

      await verifier({ EDS_REVOCATION_CHECK: 'CRL' }).verifyAuthSignature(signature(), NONCE)

      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Json
      expect(body.revocationCheck).toEqual(['CRL'])
    })
  })

  describe('запрос в NCANode', () => {
    it('открепленная подпись, challenge в base64, OCSP и таймаут', async () => {
      reply(ncaResponse())
      const cmsBase64 = signature({ indefinite: true })
      // Перенос строк base64, как бывает при копировании: в NCANode уходит канонический вид.
      const wrapped = cmsBase64.replace(/(.{76})/g, '$1\r\n')

      await verifier().verifyAuthSignature(wrapped, NONCE)

      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(String(url)).toBe('http://ncanode:14579/cms/verify')
      expect(init.method).toBe('POST')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(String(init.body))).toEqual({
        cms: cmsBase64,
        data: NONCE.toString('base64'),
        revocationCheck: ['OCSP'],
      })
    })

    // NCANode за прокси с префиксом пути — путь сохраняется.
    it.each(['http://edge.internal/ncanode', 'http://edge.internal/ncanode/'])(
      'адрес с путём: %s',
      async (base) => {
        reply(ncaResponse())

        await verifier({ NCANODE_URL: base }).verifyAuthSignature(signature(), NONCE)

        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://edge.internal/ncanode/cms/verify')
      },
    )
  })

  describe('отказ по ответу NCANode', () => {
    const notAuthCms = signature({ certificates: [SIGN_RSA_CERT] })

    it.each<[string, Json, string, string?]>([
      [
        'подпись не сошлась',
        ncaResponse({
          root: { valid: false },
          signer: { status: 'INVALID', subIndication: 'SIG_CRYPTO_FAILURE' },
        }),
        'EDS_SIGNATURE_INVALID',
      ],
      [
        'сертификат просрочен',
        ncaResponse({
          root: { valid: false },
          cert: {
            valid: false,
            notBefore: jacksonDate(-400 * DAY),
            notAfter: jacksonDate(-35 * DAY),
          },
          signer: { status: 'INDETERMINATE', subIndication: 'OUT_OF_BOUNDS_NO_POE' },
        }),
        'EDS_CERT_EXPIRED',
      ],
      [
        'сертификат ещё не действует',
        ncaResponse({
          root: { valid: false },
          cert: { valid: false, notBefore: jacksonDate(DAY), notAfter: jacksonDate(366 * DAY) },
          signer: { status: 'INDETERMINATE', subIndication: 'OUT_OF_BOUNDS_NO_POE' },
        }),
        'EDS_CERT_EXPIRED',
      ],
      // С меткой времени NCANode судит срок на время метки — для входа нужно «сейчас».
      [
        'срок вышел, хотя NCANode счёл подпись действительной',
        ncaResponse({ cert: { notAfter: jacksonDate(-DAY) } }),
        'EDS_CERT_EXPIRED',
      ],
      [
        'сертификат отозван',
        ncaResponse({
          root: { valid: false },
          cert: {
            valid: false,
            revocations: [
              { revoked: true, by: 'OCSP', revocationTime: jacksonDate(-DAY), reason: 'OK' },
            ],
          },
          signer: { status: 'INVALID', subIndication: 'CERT_REVOKED' },
        }),
        'EDS_CERT_REVOKED',
      ],
      // «Отозван после подписи» у NCANode — VALID (так правильно для документов, не для входа).
      [
        'отозван после подписи, хотя NCANode счёл подпись действительной',
        ncaResponse({
          cert: {
            revocations: [
              { revoked: true, by: 'OCSP', revocationTime: jacksonDate(0), reason: 'OK' },
            ],
          },
        }),
        'EDS_CERT_REVOKED',
      ],
      [
        'цепочка не доходит до корня НУЦ',
        ncaResponse({
          root: { valid: false },
          cert: {
            valid: false,
            revocations: [
              {
                revoked: false,
                by: 'OCSP',
                revocationTime: null,
                reason: 'Cannot find root certificate in NCANode.',
              },
            ],
          },
          signer: { status: 'INDETERMINATE', subIndication: 'CHAIN_INCOMPLETE' },
        }),
        'EDS_CERT_NOT_AUTH',
      ],
      [
        'ключ только для подписи',
        ncaResponse({ cert: { serialNumber: SIGN_RSA_CERT.serial } }),
        'EDS_CERT_NOT_AUTH',
        notAuthCms,
      ],
      // OCSP НУЦ не ответил: NCANode пишет UNKNOWN как revoked: false — выдаёт его только valid.
      [
        'OCSP НУЦ не ответил',
        ncaResponse({
          root: { valid: false },
          cert: {
            valid: false,
            revocations: [
              { revoked: false, by: 'OCSP', revocationTime: null, reason: 'Connect timed out' },
            ],
          },
          signer: { status: 'INDETERMINATE', subIndication: 'REVOCATION_DATA_MISSING' },
        }),
        'EDS_UNAVAILABLE',
      ],
      ['NCANode не проверял отзыв', ncaResponse({ cert: { revocations: [] } }), 'EDS_UNAVAILABLE'],
      [
        'NCANode насчитал двух подписантов',
        { ...ncaResponse(), signers: [...ncaResponse().signers, ...ncaResponse().signers] },
        'EDS_SIGNATURE_INVALID',
      ],
      [
        'сертификат подписанта не из этой подписи',
        ncaResponse({ cert: { serialNumber: 'abcdef' } }),
        'EDS_SIGNATURE_INVALID',
      ],
      [
        'два сертификата с номером подписанта',
        ncaResponse(),
        'EDS_SIGNATURE_INVALID',
        signature({ certificates: [GOST2015_CERT, GOST2015_CERT] }),
      ],
      ['ИИН не из 12 цифр', ncaResponse({ subject: { iin: '12345678901' } }), 'EDS_CERT_NOT_AUTH'],
      ['ИИН с буквами', ncaResponse({ subject: { iin: 'IIN123456789' } }), 'EDS_CERT_NOT_AUTH'],
      ['нет ИИН', ncaResponse({ subject: { iin: undefined } }), 'EDS_CERT_NOT_AUTH'],
      ['БИН не из 12 цифр', ncaResponse({ subject: { bin: 'Отдел кадров' } }), 'EDS_CERT_NOT_AUTH'],
    ])('%s', async (_, response, code, cmsBase64 = signature()) => {
      reply(response)

      expect(await refusal(verifier().verifyAuthSignature(cmsBase64, NONCE))).toBe(code)
    })
  })

  describe('отказ без похода в NCANode', () => {
    it.each([
      // У присоединённой подписи NCANode проверил бы вложенное содержимое, а не challenge.
      ['присоединённая подпись', signature({ attached: NONCE })],
      ['два подписанта в CMS', signature({ signers: 2 })],
      ['не base64', 'это не подпись'],
      ['не CMS', Buffer.from('hello, NCANode').toString('base64')],
      ['длиннее предела', Buffer.alloc(70_000, 1).toString('base64')],
    ])('%s', async (_, cmsBase64) => {
      expect(await refusal(verifier().verifyAuthSignature(cmsBase64, NONCE))).toBe(
        'EDS_SIGNATURE_INVALID',
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('вход по ЭЦП выключен — FEATURE_DISABLED', async () => {
      const code = await refusal(
        verifier({ EDS_LOGIN_ENABLED: false }).verifyAuthSignature(signature(), NONCE),
      )

      expect(code).toBe('FEATURE_DISABLED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('NCANode недоступен или ответил не то', () => {
    it.each([
      ['таймаут', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
      ['нет соединения', new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })],
    ])('%s — EDS_UNAVAILABLE', async (_, error) => {
      fetchMock.mockRejectedValueOnce(error)

      expect(await refusal(verifier().verifyAuthSignature(signature(), NONCE))).toBe(
        'EDS_UNAVAILABLE',
      )
    })

    it.each([
      [500, 'EDS_UNAVAILABLE'],
      // Так NCANode отвечает, пока не скачал корни и CRL.
      [503, 'EDS_UNAVAILABLE'],
      // ClientException: NCANode не разобрал подпись.
      [400, 'EDS_SIGNATURE_INVALID'],
      // Не тот адрес или прокси — поломка настройки, а не подписи.
      [404, 'EDS_UNAVAILABLE'],
    ])('HTTP %i — %s', async (status, code) => {
      reply({ status, message: 'Service is warming up' }, status)

      expect(await refusal(verifier().verifyAuthSignature(signature(), NONCE))).toBe(code)
    })

    it('ответ не JSON — EDS_UNAVAILABLE', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      })

      expect(await refusal(verifier().verifyAuthSignature(signature(), NONCE))).toBe(
        'EDS_UNAVAILABLE',
      )
    })

    it.each([
      ['чужой формат', { result: 'ok' }],
      ['дата не дата', ncaResponse({ cert: { notAfter: 'завтра' } })],
    ])('ответ не по формату (%s) — EDS_UNAVAILABLE', async (_, body) => {
      reply(body)

      expect(await refusal(verifier().verifyAuthSignature(signature(), NONCE))).toBe(
        'EDS_UNAVAILABLE',
      )
    })
  })

  it('в лог не попадают ни ИИН, ни подпись, ни серийный номер', async () => {
    const cmsBase64 = signature()
    reply(ncaResponse())
    await verifier().verifyAuthSignature(cmsBase64, NONCE)
    reply(ncaResponse({ subject: { iin: `${IIN}0` } }))
    await verifier()
      .verifyAuthSignature(cmsBase64, NONCE)
      .catch(() => null)
    reply({ status: 400, message: `bad signer IIN${IIN}` }, 400)
    await verifier()
      .verifyAuthSignature(cmsBase64, NONCE)
      .catch(() => null)
    // Ошибка формата: в лог идут пути полей, не значения.
    reply(ncaResponse({ cert: { notAfter: { iin: IIN } } }))
    await verifier()
      .verifyAuthSignature(cmsBase64, NONCE)
      .catch(() => null)

    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      expect(line).not.toContain(IIN)
      expect(line).not.toContain(GOST_SERIAL)
      expect(line).not.toContain(cmsBase64.slice(0, 40))
    }
  })
})
