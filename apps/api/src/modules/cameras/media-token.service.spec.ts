import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { MediaTokenService, MEDIA_AUDIENCE, MEDIA_ISSUER } from './media-token.service'
import type { EnvVars } from '../../config/env.schema'

// Медиатокены проверяет не API, а ретранслятор по JWKS. Тесты сверяют то, на что он
// смотрит: подпись ES256 открытым ключом из JWKS, iss/aud, срок и права на путь.

function serviceWith(env: Partial<Record<string, string>>) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService<EnvVars, true>
  return new MediaTokenService(config)
}

function keyPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
    .replace(/\n/g, '\\n')
}

describe('MediaTokenService', () => {
  it('подпись сходится с ключом из JWKS; в токене iss, aud, срок и права', () => {
    const service = serviceWith({ MEDIA_JWT_PRIVATE_KEY: keyPem() })
    const token = service.sign('user:u-1', [{ action: 'read', path: 'cam/c-1' }], 120)
    const [header, payload, signature] = token.split('.')
    const jwk = service.jwks().keys[0]!
    const ok = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    )
    expect(ok).toBe(true)
    const head = JSON.parse(Buffer.from(header!, 'base64url').toString())
    expect(head).toMatchObject({ alg: 'ES256', kid: jwk.kid })
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    expect(claims).toMatchObject({
      iss: MEDIA_ISSUER,
      aud: MEDIA_AUDIENCE,
      sub: 'user:u-1',
      mediamtx_permissions: [{ action: 'read', path: 'cam/c-1' }],
    })
    expect(claims.exp - claims.iat).toBe(120)
  })

  it('в JWKS только открытая часть ключа', () => {
    const jwk = serviceWith({ MEDIA_JWT_PRIVATE_KEY: keyPem() }).jwks().keys[0]!
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' })
    expect(jwk).not.toHaveProperty('d')
  })

  it('без ключа ретранслятор не настроен, JWKS пуст', () => {
    const service = serviceWith({})
    expect(service.relaySettings()).toBeNull()
    expect(service.jwks()).toEqual({ keys: [] })
  })

  it('ретранслятор настроен, только когда заданы ключ и все три адреса', () => {
    const base = { MEDIA_JWT_PRIVATE_KEY: keyPem(), MEDIA_RELAY_HLS_URL: 'https://media.kz/' }
    expect(serviceWith(base).relaySettings()).toBeNull()
    const full = serviceWith({
      ...base,
      MEDIA_RELAY_PUBLISH_URL: 'rtmps://relay.kz:1936',
      MEDIA_RELAY_CA_PEM: '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----',
    }).relaySettings()
    expect(full).toEqual({
      hlsUrl: 'https://media.kz',
      publishUrl: 'rtmps://relay.kz:1936',
      caPem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
    })
  })
})
