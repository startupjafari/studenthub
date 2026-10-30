import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'

// «Запечатанный конверт» для получателя с открытым ключом X25519 (docs/PROJECT.md §3.10).
//
// Пароли камер шифруются открытым ключом агента вуза: закрытый ключ есть только у агента,
// и платформа не может прочитать то, что сама положила в базу. Схема — ECIES без новых
// зависимостей: одноразовая пара X25519 → общий секрет → HKDF-SHA256 → AES-256-GCM.
//
// Формат: `v1.<одноразовый открытый ключ>.<iv>.<tag>.<шифртекст>`, всё в base64url.
// `context` (id камеры) уходит в AAD: конверт одной камеры не подложить другой — он не
// расшифруется. Тот же формат обязан открывать агент (apps/camera-agent).

const VERSION = 'v1'
const INFO = Buffer.from('studenthub-camera-credentials-v1')
const RAW_KEY_LENGTH = 32

/** Открытый ключ X25519 из base64url сырых 32 байт (так агент присылает его о себе). */
export function x25519PublicKey(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64url')
  if (bytes.length !== RAW_KEY_LENGTH) {
    throw new Error('Открытый ключ X25519 должен быть 32 байта')
  }
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw }, format: 'jwk' })
}

function rawPublic(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' })
  return Buffer.from(jwk.x ?? '', 'base64url')
}

function deriveKey(shared: Buffer, ephemeralRaw: Buffer, recipientRaw: Buffer): Buffer {
  const salt = Buffer.concat([ephemeralRaw, recipientRaw])
  return Buffer.from(hkdfSync('sha256', shared, salt, INFO, 32))
}

/** Зашифровать `plaintext` для владельца открытого ключа `recipient` (base64url). */
export function seal(plaintext: string, recipient: string, context: string): string {
  const recipientKey = x25519PublicKey(recipient)
  const ephemeral = generateKeyPairSync('x25519')
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientKey })
  const ephemeralRaw = rawPublic(ephemeral.publicKey)
  const key = deriveKey(shared, ephemeralRaw, rawPublic(recipientKey))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, ephemeralRaw, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

/**
 * Вскрыть конверт закрытым ключом получателя (JWK X25519 с полем `d`). На платформе не
 * вызывается — закрытого ключа там нет; функция для агента и для тестов формата.
 */
export function open(sealed: string, privateJwk: JsonWebKey, context: string): string {
  const [version, ephemeralB64, ivB64, tagB64, bodyB64] = sealed.split('.')
  if (version !== VERSION || !ephemeralB64 || !ivB64 || !tagB64 || bodyB64 === undefined) {
    throw new Error('Некорректный формат конверта')
  }
  const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' })
  const ephemeralKey = x25519PublicKey(ephemeralB64)
  const shared = diffieHellman({ privateKey, publicKey: ephemeralKey })
  const recipientRaw = rawPublic(createPublicKey(privateKey))
  const key = deriveKey(shared, Buffer.from(ephemeralB64, 'base64url'), recipientRaw)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(bodyB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
