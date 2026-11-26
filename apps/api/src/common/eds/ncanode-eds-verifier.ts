import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { z } from 'zod'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../exceptions/app.exception'
import { CmsFormatError, inspectCms, type CmsCertificate, type CmsInspection } from './cms-inspect'
import { EdsVerifier, type VerifiedEdsSigner } from './eds-verifier'

// Проверка ЭЦП через NCANode 3.x (github.com/ncanode-kz/NCANode, бывший malikzh/NCANode):
// POST {NCANODE_URL}/cms/verify { cms, data, revocationCheck } → CmsVerificationResponse.
// Формат запроса и ответа сверен с исходниками 3.5.1 (CmsController, CmsService.verify,
// CertificateWrapper.toCertificateInfo, AdesVerificationService.grade).
//
// Итоговому `valid` NCANode не верим и решаем сами, потому что он отвечает на вопрос
// «была ли подпись действительна, когда её поставили» — для документа верно, для входа нет:
//  - срок и отзыв он судит на «доказанное время подписи», а с меткой времени в CMS это время
//    из метки, не текущее; «отозван после подписи» у него VALID;
//  - у присоединённой подписи присланные данные он игнорирует (см. cms-inspect.ts);
//  - назначение ключа он не проверяет вовсе.
// Отсюда порядок в judge(): сначала то, без чего остальное бессмысленно (подпись, доверие),
// потом свойства ключа на «сейчас». Любое сомнение — отказ.
//
// В лог не попадают ни подпись, ни ИИН, ни серийный номер — только причина отказа.

/** Предел подписи после base64: NCALayer отдаёт 3–8 КБ, схема запроса режет на 64 000 символов. */
const MAX_CMS_BYTES = 64 * 1024

// Подындикации NCANode (dto/ades/AdesSubIndication), при которых не держится сама подпись —
// какой бы ни был сертификат: в поддельной подписи он может быть любым.
const BROKEN_SIGNATURE = new Set([
  'NO_SIGNING_CERTIFICATE_FOUND',
  'SIG_CRYPTO_FAILURE',
  'CERT_HASH_MISMATCH',
  'TIMESTAMP_INVALID',
  'FORMAT_FAILURE',
])
const REVOKED = new Set(['CERT_REVOKED', 'REVOKED_NO_POE'])
const TWELVE_DIGITS = /^\d{12}$/
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

type RefusalCode =
  | 'EDS_SIGNATURE_INVALID'
  | 'EDS_CERT_EXPIRED'
  | 'EDS_CERT_REVOKED'
  | 'EDS_CERT_NOT_AUTH'
  | 'EDS_UNAVAILABLE'

// Клиент реагирует на код, сообщение — для старых клиентов и для людей.
const REFUSAL_MESSAGE: Record<RefusalCode, string> = {
  EDS_SIGNATURE_INVALID: 'Подпись не прошла проверку',
  EDS_CERT_EXPIRED: 'Срок действия сертификата ЭЦП истёк или ещё не наступил',
  EDS_CERT_REVOKED: 'Сертификат ЭЦП отозван',
  EDS_CERT_NOT_AUTH: 'Этот ключ не подходит для входа: нужен ключ аутентификации НУЦ РК',
  EDS_UNAVAILABLE: 'Проверка ЭЦП сейчас недоступна. Войдите по паролю или повторите позже',
}

// Даты Jackson по умолчанию — ISO-строка («2026-11-26T07:00:00.000+00:00»); число (epoch ms)
// принимаем на случай другой настройки ObjectMapper.
const ncaDate = z.union([z.string(), z.number()]).pipe(z.coerce.date())

// CertificateSubject: поля без значения NCANode опускает (@JsonInclude NON_NULL).
const ncaSubject = z.object({
  commonName: z.string().nullish(),
  iin: z.string().nullish(),
  bin: z.string().nullish(),
  dn: z.string().nullish(),
})

// Строки, а не перечисления: новое значение в следующей версии NCANode должно дать отказ по
// правилам judge(), а не «сервис недоступен» у всех.
const ncaResponseSchema = z.object({
  valid: z.boolean(),
  signers: z
    .array(
      z.object({
        certificates: z
          .array(
            z.object({
              valid: z.boolean(),
              revocations: z
                .array(z.object({ revoked: z.boolean(), by: z.string().nullish() }))
                .max(16),
              notBefore: ncaDate,
              notAfter: ncaDate,
              serialNumber: z.string(),
              subject: ncaSubject.nullish(),
              issuer: ncaSubject.nullish(),
            }),
          )
          .max(8),
        status: z.string().nullish(),
        subIndication: z.string().nullish(),
      }),
    )
    .max(16),
})
type NcaResponse = z.infer<typeof ncaResponseSchema>

/**
 * Годится ли ключ для входа — по KeyUsage/extKeyUsage самого сертификата.
 *
 * - Пара ключей НУЦ до 2023 года: AUTH_RSA/AUTH_GOST — digitalSignature + keyEncipherment и
 *   extKeyUsage clientAuth; RSA/GOST «для подписи» — digitalSignature + nonRepudiation,
 *   extKeyUsage emailProtection. Второй для входа не предназначен.
 * - Единый ключ ГОСТ 2015 (GOST512_*, с 2023 года): digitalSignature + nonRepudiation +
 *   keyEncipherment, extKeyUsage emailProtection без clientAuth. НУЦ выдаёт его и для
 *   аутентификации, и для подписи — сейчас это почти все действующие ключи.
 *
 * Отличает их keyEncipherment: его нет только у ключа «для подписи».
 */
export function isAuthenticationKey(certificate: CmsCertificate): boolean {
  return certificate.digitalSignature && (certificate.clientAuth || certificate.keyEncipherment)
}

@Injectable()
export class NcaNodeEdsVerifier extends EdsVerifier {
  private readonly logger = new Logger(NcaNodeEdsVerifier.name)

  constructor(private readonly config: ConfigService<EnvVars, true>) {
    super()
  }

  async verifyAuthSignature(cmsBase64: string, data: Buffer): Promise<VerifiedEdsSigner> {
    if (!this.config.get('EDS_LOGIN_ENABLED', { infer: true })) {
      throw new AppException('FEATURE_DISABLED', 'Вход по ЭЦП выключен')
    }
    // Ошибка вызывающего кода, а не клиента: подпись над пустыми данными ничего не доказывает.
    if (data.length === 0) throw new Error('EdsVerifier: пустые данные для проверки подписи')

    // До NCANode — то, что видно без него: мусор и присоединённая подпись в сеть не уходят.
    const der = decodeBase64(cmsBase64)
    if (!der || der.length > MAX_CMS_BYTES) {
      throw this.refuse('EDS_SIGNATURE_INVALID', 'подпись не base64 или длиннее предела')
    }
    let cms: CmsInspection
    try {
      cms = inspectCms(der)
    } catch (error) {
      if (!(error instanceof CmsFormatError)) throw error
      throw this.refuse('EDS_SIGNATURE_INVALID', `не CMS SignedData: ${error.message}`)
    }
    if (!cms.detached) {
      throw this.refuse(
        'EDS_SIGNATURE_INVALID',
        'присоединённая подпись вместо открепленной',
        'warn',
      )
    }
    if (cms.signerCount !== 1) {
      throw this.refuse('EDS_SIGNATURE_INVALID', `подписантов в CMS: ${cms.signerCount}`, 'warn')
    }

    const response = await this.requestVerification(der, data)
    return this.judge(response, cms, new Date())
  }

  private async requestVerification(der: Buffer, data: Buffer): Promise<NcaResponse> {
    const base = this.config.get('NCANODE_URL', { infer: true })
    // Схема окружения не даёт стартовать без адреса при включённом входе; здесь — на случай,
    // если кто-то обойдёт её в тестовом стенде.
    if (!base) throw this.refuse('EDS_UNAVAILABLE', 'NCANODE_URL не задан', 'error')
    const url = new URL('cms/verify', base.endsWith('/') ? base : `${base}/`)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          // Канонический base64 от тех же байтов, что разобрал inspectCms: NCANode проверяет
          // ровно то, что проверили мы, а не «тот же» текст с переносами строк.
          cms: der.toString('base64'),
          data: data.toString('base64'),
          revocationCheck: [this.config.get('EDS_REVOCATION_CHECK', { infer: true })],
        }),
        signal: AbortSignal.timeout(this.config.get('NCANODE_TIMEOUT_MS', { infer: true })),
      })
    } catch (error) {
      throw this.refuse('EDS_UNAVAILABLE', `NCANode не ответил: ${describeError(error)}`)
    }

    // 5xx — сбой самого NCANode; 503 он отдаёт и пока прогревается (не скачаны корни и CRL).
    if (response.status >= 500) {
      const detail = await errorMessage(response)
      throw this.refuse('EDS_UNAVAILABLE', `NCANode ответил ${response.status}${detail}`)
    }
    // 400 — ClientException: NCANode не смог разобрать подпись. Прочие 4xx — не про подпись, а
    // про адрес или прокси перед NCANode (404, 401/403): сказать человеку «подпись неверна»
    // значило бы спрятать поломку настройки.
    if (response.status === 400) {
      const detail = await errorMessage(response)
      throw this.refuse('EDS_SIGNATURE_INVALID', `NCANode не принял подпись${detail}`)
    }
    if (response.status !== 200) {
      throw this.refuse('EDS_UNAVAILABLE', `NCANode ответил ${response.status}`, 'error')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw this.refuse(
        'EDS_UNAVAILABLE',
        `ответ NCANode не JSON: ${describeError(error)}`,
        'error',
      )
    }
    const parsed = ncaResponseSchema.safeParse(body)
    if (!parsed.success) {
      // Только пути полей: в значениях может оказаться ИИН.
      const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '(корень)')
      throw this.refuse(
        'EDS_UNAVAILABLE',
        `ответ NCANode не по формату: ${paths.join(', ')}`,
        'error',
      )
    }
    return parsed.data
  }

  private judge(response: NcaResponse, cms: CmsInspection, now: Date): VerifiedEdsSigner {
    const [signer, ...otherSigners] = response.signers
    if (!signer || otherSigners.length > 0) {
      const count = response.signers.length
      throw this.refuse('EDS_SIGNATURE_INVALID', `NCANode насчитал подписантов: ${count}`, 'warn')
    }
    const [cert, ...otherCerts] = signer.certificates
    if (!cert || otherCerts.length > 0) {
      throw this.refuse('EDS_SIGNATURE_INVALID', 'у подписанта не ровно один сертификат')
    }
    const sub = signer.subIndication ?? null
    const revocationMethod = this.config.get('EDS_REVOCATION_CHECK', { infer: true })

    // 1. Подпись не держится математически — смотреть на сертификат бессмысленно.
    if (sub && BROKEN_SIGNATURE.has(sub)) {
      throw this.refuse('EDS_SIGNATURE_INVALID', `подпись не сошлась (${sub})`)
    }
    // 2. Цепочка не дошла до корня из NCANODE_CA_URL: ключ выдан не НУЦ РК — или не тем
    //    (тестовый ключ против боевых корней и наоборот).
    if (sub === 'CHAIN_INCOMPLETE') {
      throw this.refuse('EDS_CERT_NOT_AUTH', 'цепочка не доходит до доверенного корня')
    }

    // 3. Назначение ключа — по самому сертификату из CMS. Тот ли это сертификат, что проверил
    //    NCANode: он выбирает подписанта по издателю и серийному номеру, так что единственный
    //    сертификат с этим номером в CMS — тот самый, а его подлинность NCANode подтвердил
    //    цепочкой (без неё отказ случился бы на шаге 2).
    const serial = normalizeSerial(cert.serialNumber)
    const candidates = cms.certificates.filter((candidate) => candidate.serialHex === serial)
    const [signerCertificate] = candidates
    if (!signerCertificate || candidates.length !== 1) {
      const reason = `сертификатов подписанта в CMS: ${candidates.length}`
      throw this.refuse('EDS_SIGNATURE_INVALID', reason, 'warn')
    }
    if (!isAuthenticationKey(signerCertificate)) {
      throw this.refuse('EDS_CERT_NOT_AUTH', 'ключ не для аутентификации (ключ подписи)')
    }

    // 4. Срок — на «сейчас», не на время подписи из метки.
    if (now < cert.notBefore || now > cert.notAfter || sub === 'OUT_OF_BOUNDS_NO_POE') {
      throw this.refuse('EDS_CERT_EXPIRED', 'сертификат вне срока действия')
    }

    // 5. Отзыв — любой признак, хоть «после подписи». Затем — что NCANode вообще проверял
    //    отзыв запрошенным способом: без записи об этом молчание ничего не значит.
    if (cert.revocations.some((entry) => entry.revoked) || (sub && REVOKED.has(sub))) {
      throw this.refuse('EDS_CERT_REVOKED', 'сертификат отозван')
    }
    if (!cert.revocations.some((entry) => entry.by === revocationMethod)) {
      const reason = `NCANode не проверил отзыв (${revocationMethod})`
      throw this.refuse('EDS_UNAVAILABLE', reason, 'error')
    }

    // 6. Итог NCANode. OCSP-ответ UNKNOWN (сервер НУЦ не ответил) выглядит в revocations как
    //    revoked: false и виден только здесь: valid сертификата требует, чтобы все ответы были
    //    «действует». Это недоступность проверки, а не дефект ключа.
    if (!cert.valid || sub === 'REVOCATION_DATA_MISSING') {
      throw this.refuse('EDS_UNAVAILABLE', `статус отзыва не подтверждён (${revocationMethod})`)
    }
    if (signer.status !== 'VALID' || !response.valid) {
      const verdict = `${signer.status ?? '—'}/${sub ?? '—'}`
      throw this.refuse('EDS_SIGNATURE_INVALID', `NCANode не признал подпись (${verdict})`)
    }

    // 7. Владелец. ИИН — из SERIALNUMBER=IIN…, БИН — из OU=BIN… (CertificateWrapper NCANode).
    //    Не того вида — не сертификат физлица НУЦ; гадать, что имелось в виду, не станем.
    const iin = cert.subject?.iin ?? ''
    if (!TWELVE_DIGITS.test(iin)) {
      throw this.refuse('EDS_CERT_NOT_AUTH', 'в сертификате нет ИИН из 12 цифр')
    }
    const orgBin = cert.subject?.bin || null
    if (orgBin !== null && !TWELVE_DIGITS.test(orgBin)) {
      throw this.refuse('EDS_CERT_NOT_AUTH', 'БИН в сертификате не из 12 цифр')
    }
    const subjectCn = cert.subject?.commonName?.trim()
    const certIssuer = cert.issuer?.commonName?.trim() || cert.issuer?.dn?.trim()
    if (!subjectCn || !certIssuer) {
      throw this.refuse('EDS_CERT_NOT_AUTH', 'в сертификате нет имени владельца или издателя')
    }

    return {
      iin,
      orgBin,
      subjectCn,
      certSerial: serial,
      certIssuer,
      certNotBefore: cert.notBefore,
      certNotAfter: cert.notAfter,
    }
  }

  /**
   * Отказ с записью причины. Причина — для разбора обращений: клиенту уходит только код.
   * Обычные отказы (просрочен, не тот ключ) — log; похожее на подделку — warn; сломанная
   * настройка или контракт NCANode — error.
   *
   * 12 цифр подряд маскируются в любой причине: в неё попадают тексты чужих ошибок (сообщение
   * NCANode, SyntaxError разбора JSON цитирует кусок тела), и ИИН мог бы проехать с ними.
   */
  private refuse(
    code: RefusalCode,
    reason: string,
    level: 'log' | 'warn' | 'error' = code === 'EDS_UNAVAILABLE' ? 'warn' : 'log',
  ): AppException {
    this.logger[level](`ЭЦП: отказ ${code} — ${maskIin(reason)}`)
    return new AppException(code, REFUSAL_MESSAGE[code])
  }
}

/** Строгий base64: Buffer.from(…, 'base64') молча пропускает мусор, а нам нужен отказ. */
function decodeBase64(text: string): Buffer | null {
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0 || compact.length % 4 !== 0 || !STRICT_BASE64.test(compact)) return null
  return Buffer.from(compact, 'base64')
}

function maskIin(text: string): string {
  return text.replace(/\d{12}/g, '<12 цифр>')
}

/** Серийный номер в виде NCANode: BigInteger.toString(16) — нижний регистр, без нулей слева. */
function normalizeSerial(serial: string): string {
  return serial.trim().toLowerCase().replace(/^0+/, '') || '0'
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  const code =
    cause && typeof cause === 'object' && 'code' in cause ? ` (${String(cause.code)})` : ''
  return `${error.name}: ${error.message}${code}`
}

/**
 * `message` из ErrorResponse NCANode — подсказка для лога (например, «Service is warming
 * up…»). Это текст исключения Java, а не наш, поэтому обрезается.
 */
async function errorMessage(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // Тело ошибки необязательно: без него в логе останется код ответа.
    return ''
  }
  const message =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message: unknown }).message
      : null
  if (typeof message !== 'string' || message.length === 0) return ''
  // Маска до обрезки: иначе на границе осталась бы половина ИИН.
  return `: ${maskIin(message).slice(0, 200)}`
}
