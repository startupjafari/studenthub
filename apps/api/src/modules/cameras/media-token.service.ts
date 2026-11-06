import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'
import type { EnvVars } from '../../config/env.schema'

// Медиатокены для ретранслятора камер (docs/PROJECT.md §3.10): короткие JWT ES256, которые
// MediaMTX проверяет сам по нашему открытому ключу (JWKS) — без запроса к API на каждый
// HLS-сегмент. Подпись — встроенный node:crypto, без JWT-библиотеки: формат тривиален,
// а `dsaEncoding: 'ieee-p1363'` сразу даёт подпись в виде r||s, как требует JOSE.

export const MEDIA_ISSUER = 'studenthub'
export const MEDIA_AUDIENCE = 'studenthub-media'

/** Право MediaMTX: действие над путём `cam/<id>`. */
export interface MediaPermission {
  action: 'read' | 'publish'
  path: string
}

export interface RelaySettings {
  hlsUrl: string
  publishUrl: string
  caPem: string
}

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')

@Injectable()
export class MediaTokenService {
  private readonly privateKey: KeyObject | null
  private readonly publicJwk: JsonWebKey | null
  private readonly kid: string | null
  private readonly relay: RelaySettings | null

  constructor(config: ConfigService<EnvVars, true>) {
    const pem = config.get('MEDIA_JWT_PRIVATE_KEY', { infer: true })?.replace(/\\n/g, '\n')
    this.privateKey = pem ? createPrivateKey(pem) : null
    this.publicJwk = this.privateKey
      ? createPublicKey(this.privateKey).export({ format: 'jwk' })
      : null
    // kid — отпечаток открытого ключа: сменили ключ — сменился и kid.
    this.kid = this.publicJwk
      ? createHash('sha256').update(JSON.stringify(this.publicJwk)).digest('base64url').slice(0, 16)
      : null
    const hlsUrl = config.get('MEDIA_RELAY_HLS_URL', { infer: true })
    const publishUrl = config.get('MEDIA_RELAY_PUBLISH_URL', { infer: true })
    const caPem = config.get('MEDIA_RELAY_CA_PEM', { infer: true })?.replace(/\\n/g, '\n')
    this.relay =
      this.privateKey && hlsUrl && publishUrl && caPem
        ? { hlsUrl: hlsUrl.replace(/\/+$/, ''), publishUrl, caPem }
        : null
  }

  /** Ретранслятор настроен целиком: есть ключ подписи и все адреса. */
  relaySettings(): RelaySettings | null {
    return this.relay
  }

  /** Подписать токен на права `permissions` для `subject` на `ttlSeconds`. */
  sign(subject: string, permissions: MediaPermission[], ttlSeconds: number): string {
    if (!this.privateKey || !this.kid) throw new Error('Ключ медиатокенов не задан')
    const now = Math.floor(Date.now() / 1000)
    const header = b64url({ alg: 'ES256', typ: 'JWT', kid: this.kid })
    const payload = b64url({
      iss: MEDIA_ISSUER,
      aud: MEDIA_AUDIENCE,
      sub: subject,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomUUID(),
      mediamtx_permissions: permissions,
    })
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: this.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url')
    return `${header}.${payload}.${signature}`
  }

  /** Открытый ключ для ретранслятора. Без ключа — пустой набор. */
  jwks(): { keys: JsonWebKey[] } {
    if (!this.publicJwk || !this.kid) return { keys: [] }
    return { keys: [{ ...this.publicJwk, kid: this.kid, alg: 'ES256', use: 'sig' }] }
  }
}
