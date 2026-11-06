import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  type JsonWebKey,
} from 'node:crypto'

// Вскрытие конверта с паролем камеры. Зеркало apps/api/src/common/crypto/sealed-box.ts:
// формат `v1.<одноразовый открытый ключ>.<iv>.<tag>.<шифртекст>` (base64url), X25519 →
// HKDF-SHA256 → AES-256-GCM, id камеры в AAD. Совпадение форматов проверяет тест на
// векторе, выпущенном кодом платформы.

const VERSION = 'v1'
const INFO = Buffer.from('studenthub-camera-credentials-v1')

function rawPublic(jwk: JsonWebKey): Buffer {
  return Buffer.from(jwk.x ?? '', 'base64url')
}

export function openSealed(sealed: string, privateJwk: JsonWebKey, context: string): string {
  const [version, ephemeralB64, ivB64, tagB64, bodyB64] = sealed.split('.')
  if (version !== VERSION || !ephemeralB64 || !ivB64 || !tagB64 || bodyB64 === undefined) {
    throw new Error('Некорректный формат конверта')
  }
  const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' })
  const ephemeralKey = createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: ephemeralB64 },
    format: 'jwk',
  })
  const shared = diffieHellman({ privateKey, publicKey: ephemeralKey })
  const salt = Buffer.concat([Buffer.from(ephemeralB64, 'base64url'), rawPublic(privateJwk)])
  const key = Buffer.from(hkdfSync('sha256', shared, salt, INFO, 32))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(bodyB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export interface CameraCredentials {
  username: string
  password: string
}

/** Учётные данные камеры из конверта. Пароль живёт только в памяти агента. */
export function openCredentials(
  sealed: string,
  privateJwk: JsonWebKey,
  cameraId: string,
): CameraCredentials {
  const parsed = JSON.parse(openSealed(sealed, privateJwk, cameraId)) as Partial<CameraCredentials>
  if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
    throw new Error('В конверте нет логина и пароля')
  }
  return { username: parsed.username, password: parsed.password }
}
