import { generateKeyPairSync, type JsonWebKey } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Ключ агента X25519. Открытая часть уходит платформе, ею шифруются пароли камер;
// закрытая — только здесь, в файле с правами 600. Потерять файл (пересоздали контейнер
// без тома) — значит потерять доступ к паролям камер: платформа примет новый ключ только
// после перевыпуска токена в разделе «Камеры».

export interface AgentKey {
  /** base64url 32 байт — так ключ уходит платформе. */
  publicRaw: string
  privateJwk: JsonWebKey
}

const FILE = 'agent-key.json'

export function loadOrCreateKey(stateDir: string): AgentKey {
  const path = join(stateDir, FILE)
  if (existsSync(path)) {
    const jwk = JSON.parse(readFileSync(path, 'utf8')) as JsonWebKey
    if (jwk.kty !== 'OKP' || jwk.crv !== 'X25519' || !jwk.x || !jwk.d) {
      throw new Error(`Файл ключа агента повреждён: ${path}`)
    }
    return { publicRaw: jwk.x, privateJwk: jwk }
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const pair = generateKeyPairSync('x25519')
  const jwk = pair.privateKey.export({ format: 'jwk' })
  // `wx` — не перезаписать ключ, который успел создать параллельно запущенный экземпляр.
  writeFileSync(path, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  return { publicRaw: jwk.x as string, privateJwk: jwk }
}
