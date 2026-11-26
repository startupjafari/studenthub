/**
 * Синтетические CMS и сертификаты для тестов проверки ЭЦП. Структура настоящая (RFC 5652,
 * RFC 5280) — ровно та, что разбирает cms-inspect.ts; подписи и ключи внутри — заглушки:
 * математику подписи проверяет NCANode, а в unit-тестах его ответ подменён.
 *
 * Наборы KeyUsage/extKeyUsage — как у тестовых сертификатов НУЦ РК из SDK (сверено по
 * сертификатам из репозитория NCANode, src/test/resources).
 */

/** TLV с длиной в definite-форме (DER). */
export function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const n = body.length
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return Buffer.concat([Buffer.from([tag, ...length]), body])
}

/** TLV с indefinite-длиной и маркером конца — так NCALayer пишет CMS. */
export function ber(tag: number, ...parts: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([tag, 0x80]), ...parts, Buffer.from([0, 0])])
}

const oid = (hex: string): Buffer => der(0x06, Buffer.from(hex, 'hex'))
const integer = (hex: string): Buffer => der(0x02, Buffer.from(hex, 'hex'))

const OID_SIGNED_DATA = '2a864886f70d010702'
const OID_DATA = '2a864886f70d010701'
const OID_SHA256_RSA = '2a864886f70d01010b'

/** Биты KeyUsage (первый октет флагов). */
export const KU = { digitalSignature: 0x80, nonRepudiation: 0x40, keyEncipherment: 0x20 }

/** extKeyUsage тестовых сертификатов НУЦ. */
export const EKU = {
  clientAuth: '2b06010505070302',
  emailProtection: '2b06010505070304',
  /** 1.2.398.3.3.4.1.1 — «физическое лицо». */
  individual: '2a830e0303040101',
}

export interface CertificateSpec {
  /** Серийный номер hex, как в DER (возможен ведущий 00). */
  serial: string
  keyUsage?: number
  extKeyUsage?: string[]
  /** Готовые расширения сверх перечисленных — для кривых сертификатов. */
  extraExtensions?: Buffer[]
}

/** Расширение extKeyUsage (2.5.29.37) со списком назначений. */
export function extKeyUsageExtension(purposes: string[]): Buffer {
  return der(0x30, oid('551d25'), der(0x04, der(0x30, ...purposes.map(oid))))
}

/** Ключ аутентификации старой пары (AUTH_RSA): digitalSignature + keyEncipherment, clientAuth. */
export const AUTH_RSA_CERT: CertificateSpec = {
  serial: '247c3fda89fa641ea226987393cdaf3f5baf24b3',
  keyUsage: KU.digitalSignature | KU.keyEncipherment,
  extKeyUsage: [EKU.clientAuth, EKU.individual],
}

/** Единый ключ ГОСТ 2015 (GOST512_*): все три бита, extKeyUsage без clientAuth. */
export const GOST2015_CERT: CertificateSpec = {
  serial: '0ff06211dc82beb00253ffa000f1de84abef454f',
  keyUsage: KU.digitalSignature | KU.nonRepudiation | KU.keyEncipherment,
  extKeyUsage: [EKU.emailProtection, EKU.individual],
}

/** Ключ «только подписи» старой пары (RSA): digitalSignature + nonRepudiation. */
export const SIGN_RSA_CERT: CertificateSpec = {
  serial: '41e45cc8a04c705963e5cd6769848a934d8eaef5',
  keyUsage: KU.digitalSignature | KU.nonRepudiation,
  extKeyUsage: [EKU.emailProtection, EKU.individual],
}

export function certificate(spec: CertificateSpec): Buffer {
  const extensions: Buffer[] = []
  if (spec.keyUsage !== undefined) {
    // critical TRUE, как у НУЦ; первый октет BIT STRING — число неиспользуемых битов.
    const keyUsage = der(0x03, Buffer.from([0x05, spec.keyUsage]))
    extensions.push(der(0x30, oid('551d0f'), der(0x01, Buffer.from([0xff])), der(0x04, keyUsage)))
  }
  if (spec.extKeyUsage) extensions.push(extKeyUsageExtension(spec.extKeyUsage))
  extensions.push(...(spec.extraExtensions ?? []))
  const algorithm = der(0x30, oid(OID_SHA256_RSA), der(0x05))
  const tbs = der(
    0x30,
    der(0xa0, integer('02')),
    integer(spec.serial),
    algorithm,
    der(0x30), // issuer
    der(0x30), // validity
    der(0x30), // subject
    der(0x30), // subjectPublicKeyInfo
    der(0xa3, der(0x30, ...extensions)),
  )
  return der(0x30, tbs, algorithm, der(0x03, Buffer.from([0x00, 0xde, 0xad])))
}

export interface CmsSpec {
  /** Содержимое внутри подписи — присоединённая (attached) CMS. */
  attached?: Buffer
  signers?: number
  certificates?: CertificateSpec[]
  /** Indefinite-длины на внешних уровнях, как у NCALayer. */
  indefinite?: boolean
}

export function cms(spec: CmsSpec = {}): Buffer {
  const wrap = spec.indefinite ? ber : der
  const encap = spec.attached
    ? wrap(0x30, oid(OID_DATA), wrap(0xa0, der(0x04, spec.attached)))
    : wrap(0x30, oid(OID_DATA))
  const signerInfo = der(0x30, integer('01'))
  const signedData = wrap(
    0x30,
    integer('01'),
    der(0x31, der(0x30, oid('608648016503040201'))),
    encap,
    wrap(0xa0, ...(spec.certificates ?? [GOST2015_CERT]).map(certificate)),
    wrap(0x31, ...Array.from({ length: spec.signers ?? 1 }, () => signerInfo)),
  )
  return wrap(0x30, oid(OID_SIGNED_DATA), wrap(0xa0, signedData))
}
