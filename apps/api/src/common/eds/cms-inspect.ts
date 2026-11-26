// Свой разбор CMS-подписи — ровно в том, о чём NCANode молчит или чему верить нельзя.
//
// 1. Открепленность. NCANode (CmsService.verify, 3.5.x) подставляет присланные `data`, только
//    если в подписи нет своего содержимого: у присоединённой (attached) подписи он молча
//    проверяет вложенное и наши данные игнорирует. Любая attached-подпись владельца ключа —
//    подписанный им когда-то и где-то документ — прошла бы как «подпись над challenge».
// 2. Назначение ключа. NCANode сводит KeyUsage к AUTH/SIGN по двум битам и не отдаёт
//    extKeyUsage вовсе. Единый ключ ГОСТ 2015, который НУЦ выдаёт с 2023 года вместо пары
//    AUTH_RSA + RSA, у него выходит SIGN — как и старый ключ «только для подписи». Различить
//    их можно лишь по самому сертификату, его и читаем из той же CMS.
//
// Читатель BER минимальный: длины definite и indefinite (NCALayer пишет CMS с indefinite —
// base64 начинается с «MIAGCSqGSIb3DQEHAqCA»), глубина вложенности ограничена. Всё
// непонятное — исключение, а не догадка: для проверки подписи «не разобрал» = «не принял».

/** Структура не похожа на CMS SignedData или сертификат X.509. */
export class CmsFormatError extends Error {}

/** Сертификат из CMS: только то, что нужно для решения «годится ли ключ для входа». */
export interface CmsCertificate {
  /** Серийный номер: hex в нижнем регистре без ведущих нулей — как его пишет NCANode. */
  serialHex: string
  digitalSignature: boolean
  nonRepudiation: boolean
  keyEncipherment: boolean
  /** В extKeyUsage есть id-kp-clientAuth (1.3.6.1.5.5.7.3.2). */
  clientAuth: boolean
}

export interface CmsInspection {
  /** Содержимого внутри подписи нет — проверяется ровно то, что прислали отдельно. */
  detached: boolean
  signerCount: number
  certificates: CmsCertificate[]
}

const SEQUENCE = 0x30
const SET = 0x31
const INTEGER = 0x02
const BIT_STRING = 0x03
const OCTET_STRING = 0x04
const OBJECT_ID = 0x06
const CONTEXT_0 = 0xa0
const CONTEXT_1 = 0xa1
const CONTEXT_3 = 0xa3

// OID в DER-виде (без тега и длины): сравниваем байты, а не точечную запись.
const OID_SIGNED_DATA = Buffer.from('2a864886f70d010702', 'hex') // 1.2.840.113549.1.7.2
const OID_KEY_USAGE = Buffer.from('551d0f', 'hex') // 2.5.29.15
const OID_EXT_KEY_USAGE = Buffer.from('551d25', 'hex') // 2.5.29.37
const OID_CLIENT_AUTH = Buffer.from('2b06010505070302', 'hex') // 1.3.6.1.5.5.7.3.2

// Настоящая подпись NCALayer — CMS глубиной меньше десяти уровней. Предел защищает стек
// от присланной «матрёшки» из indefinite-длин.
const MAX_DEPTH = 32

interface Tlv {
  /** Первый октет идентификатора: класс, конструктивность, номер тега (если < 31). */
  tag: number
  contentStart: number
  /** Конец содержимого; у indefinite — позиция маркера конца (00 00). */
  contentEnd: number
  /** Конец элемента целиком, вместе с маркером конца. */
  end: number
}

function readTlv(buf: Buffer, offset: number, limit: number, depth: number): Tlv {
  if (depth > MAX_DEPTH) throw new CmsFormatError('слишком глубокая вложенность')
  let p = offset
  const tag = byteAt(buf, p++, limit)
  if ((tag & 0x1f) === 0x1f) {
    // Длинная форма номера тега: в наших структурах её нет, но внутри пропускаемых
    // элементов встретиться может — дочитываем октеты номера до первого без старшего бита.
    for (let octets = 1; (byteAt(buf, p++, limit) & 0x80) !== 0; octets++) {
      if (octets >= 4) throw new CmsFormatError('слишком длинный номер тега')
    }
  }
  const first = byteAt(buf, p++, limit)
  if (first === 0x80) {
    if ((tag & 0x20) === 0) throw new CmsFormatError('indefinite-длина у примитивного типа')
    const contentStart = p
    while (byteAt(buf, p, limit) !== 0 || byteAt(buf, p + 1, limit) !== 0) {
      p = readTlv(buf, p, limit, depth + 1).end
    }
    return { tag, contentStart, contentEnd: p, end: p + 2 }
  }
  let length = first
  if ((first & 0x80) !== 0) {
    const octets = first & 0x7f
    if (octets > 4) throw new CmsFormatError('слишком длинное поле длины')
    length = 0
    for (let i = 0; i < octets; i++) length = length * 256 + byteAt(buf, p++, limit)
  }
  const contentEnd = p + length
  if (contentEnd > limit) throw new CmsFormatError('длина выходит за границы')
  return { tag, contentStart: p, contentEnd, end: contentEnd }
}

function byteAt(buf: Buffer, index: number, limit: number): number {
  if (index >= limit) throw new CmsFormatError('обрыв структуры')
  return buf[index] as number
}

function childrenOf(buf: Buffer, parent: Tlv): Tlv[] {
  const children: Tlv[] = []
  for (let p = parent.contentStart; p < parent.contentEnd;) {
    const child = readTlv(buf, p, parent.contentEnd, 0)
    children.push(child)
    p = child.end
  }
  return children
}

function contentOf(buf: Buffer, tlv: Tlv): Buffer {
  return buf.subarray(tlv.contentStart, tlv.contentEnd)
}

function expectTag(tlv: Tlv | undefined, tag: number, what: string): Tlv {
  if (tlv?.tag !== tag) throw new CmsFormatError(`ожидался ${what}`)
  return tlv
}

/**
 * ContentInfo { signedData, [0] SignedData { version, digestAlgorithms, encapContentInfo,
 * [0] certificates?, [1] crls?, signerInfos } } — RFC 5652 §3, §5.1.
 */
export function inspectCms(der: Buffer): CmsInspection {
  const root = expectTag(readTlv(der, 0, der.length, 0), SEQUENCE, 'ContentInfo')
  // Хвост после подписи — не то, что прислал NCALayer; разбирать «первую половину» не станем.
  if (root.end !== der.length) throw new CmsFormatError('данные после ContentInfo')
  const [contentType, wrapper] = childrenOf(der, root)
  const oid = expectTag(contentType, OBJECT_ID, 'contentType')
  if (!contentOf(der, oid).equals(OID_SIGNED_DATA)) throw new CmsFormatError('не SignedData')
  const signedData = expectTag(
    childrenOf(der, expectTag(wrapper, CONTEXT_0, '[0] content'))[0],
    SEQUENCE,
    'SignedData',
  )

  const parts = childrenOf(der, signedData)
  expectTag(parts[0], INTEGER, 'version')
  expectTag(parts[1], SET, 'digestAlgorithms')
  const encap = childrenOf(der, expectTag(parts[2], SEQUENCE, 'encapContentInfo'))
  expectTag(encap[0], OBJECT_ID, 'eContentType')
  // eContent — необязательный [0]. Его наличие, даже пустого, и делает подпись присоединённой:
  // NCANode тогда проверяет его, а не наши данные.
  if (encap.length > 2 || (encap.length === 2 && encap[1]?.tag !== CONTEXT_0)) {
    throw new CmsFormatError('лишнее в encapContentInfo')
  }

  if (parts.length < 4) throw new CmsFormatError('нет signerInfos')
  const signerInfos = expectTag(parts[parts.length - 1], SET, 'signerInfos')
  const optional = parts.slice(3, -1)
  if (optional.some((part) => part.tag !== CONTEXT_0 && part.tag !== CONTEXT_1)) {
    throw new CmsFormatError('лишнее в SignedData')
  }
  const certificateSet = optional.find((part) => part.tag === CONTEXT_0)
  const certificates = certificateSet
    ? childrenOf(der, certificateSet)
        // CertificateChoices: кроме X.509 бывают атрибутные и прочие — для входа не значат ничего.
        .filter((choice) => choice.tag === SEQUENCE)
        .map((certificate) => readCertificate(der, certificate))
    : []

  return {
    detached: encap.length === 1,
    signerCount: childrenOf(der, signerInfos).length,
    certificates,
  }
}

/**
 * Certificate { TBSCertificate { [0] version?, serialNumber, signature, issuer, validity,
 * subject, subjectPublicKeyInfo, [1]?, [2]?, [3] extensions? }, ... } — RFC 5280 §4.1.
 */
function readCertificate(der: Buffer, certificate: Tlv): CmsCertificate {
  const tbs = childrenOf(
    der,
    expectTag(childrenOf(der, certificate)[0], SEQUENCE, 'TBSCertificate'),
  )
  const serialIndex = tbs[0]?.tag === CONTEXT_0 ? 1 : 0
  const serial = expectTag(tbs[serialIndex], INTEGER, 'serialNumber')
  const result: CmsCertificate = {
    serialHex: contentOf(der, serial).toString('hex').replace(/^0+/, '') || '0',
    digitalSignature: false,
    nonRepudiation: false,
    keyEncipherment: false,
    clientAuth: false,
  }

  const extensionsWrapper = tbs.slice(serialIndex + 1).find((field) => field.tag === CONTEXT_3)
  if (!extensionsWrapper) return result
  const extensions = expectTag(childrenOf(der, extensionsWrapper)[0], SEQUENCE, 'Extensions')
  const seen = new Set<string>()
  for (const extension of childrenOf(der, extensions)) {
    // Extension { extnID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
    const fields = childrenOf(der, expectTag(extension, SEQUENCE, 'Extension'))
    const id = contentOf(der, expectTag(fields[0], OBJECT_ID, 'extnID'))
    const value = contentOf(der, expectTag(fields[fields.length - 1], OCTET_STRING, 'extnValue'))
    const key = id.toString('hex')
    // Повтор расширения запрещён RFC 5280: какое из двух прочитал бы Kalkan — неизвестно.
    if (seen.has(key)) throw new CmsFormatError('повтор расширения сертификата')
    seen.add(key)
    if (id.equals(OID_KEY_USAGE)) Object.assign(result, readKeyUsage(value))
    else if (id.equals(OID_EXT_KEY_USAGE)) result.clientAuth = readClientAuth(value)
  }
  return result
}

/** KeyUsage ::= BIT STRING; бит 0 — digitalSignature, 1 — nonRepudiation, 2 — keyEncipherment. */
function readKeyUsage(
  value: Buffer,
): Pick<CmsCertificate, 'digitalSignature' | 'nonRepudiation' | 'keyEncipherment'> {
  const bits = readTlv(value, 0, value.length, 0)
  if (bits.tag !== BIT_STRING || bits.end !== value.length) throw new CmsFormatError('KeyUsage')
  // Первый октет BIT STRING — число неиспользуемых битов, флаги начинаются со второго.
  const flags = bits.contentEnd - bits.contentStart > 1 ? (value[bits.contentStart + 1] ?? 0) : 0
  return {
    digitalSignature: (flags & 0x80) !== 0,
    nonRepudiation: (flags & 0x40) !== 0,
    keyEncipherment: (flags & 0x20) !== 0,
  }
}

/** ExtKeyUsageSyntax ::= SEQUENCE OF KeyPurposeId (OID). */
function readClientAuth(value: Buffer): boolean {
  const list = readTlv(value, 0, value.length, 0)
  if (list.tag !== SEQUENCE || list.end !== value.length) throw new CmsFormatError('ExtKeyUsage')
  return childrenOf(value, list).some((purpose) =>
    contentOf(value, expectTag(purpose, OBJECT_ID, 'KeyPurposeId')).equals(OID_CLIENT_AUTH),
  )
}
