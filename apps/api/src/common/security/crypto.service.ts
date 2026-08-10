import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { EnvVars } from '../../config/env.schema'

// Симметричное шифрование секретов, которые обязаны быть обратимыми (в отличие от паролей):
// TOTP-секрет 2FA. AES-256-GCM (шифр + аутентификация). Ключ — из TOTP_ENCRYPTION_KEY,
// приведённый к 32 байтам через sha256. Формат хранения: base64(iv):base64(tag):base64(cipher).
@Injectable()
export class CryptoService {
  private readonly key: Buffer

  constructor(config: ConfigService<EnvVars, true>) {
    this.key = createHash('sha256')
      .update(config.get('TOTP_ENCRYPTION_KEY', { infer: true }))
      .digest()
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':')
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Некорректный формат шифртекста')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
}
