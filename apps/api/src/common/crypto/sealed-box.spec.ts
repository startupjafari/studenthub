import { generateKeyPairSync, type JsonWebKey } from 'node:crypto'
import { open, seal, x25519PublicKey } from './sealed-box'

// Конверт для агента камер: платформа шифрует пароль камеры его открытым ключом и сама
// прочитать результат не может. Тесты закрывают формат с обеих сторон и подмены.

function agentKeys() {
  const pair = generateKeyPairSync('x25519')
  const publicRaw = pair.publicKey.export({ format: 'jwk' }).x as string
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as JsonWebKey
  return { publicRaw, privateJwk }
}

describe('sealed-box', () => {
  it('вскрывается закрытым ключом получателя', () => {
    const { publicRaw, privateJwk } = agentKeys()
    const sealed = seal('{"username":"admin","password":"Пароль 1"}', publicRaw, 'cam-1')
    expect(open(sealed, privateJwk, 'cam-1')).toBe('{"username":"admin","password":"Пароль 1"}')
  })

  it('в конверте нет открытого текста, и каждый конверт свой', () => {
    const { publicRaw } = agentKeys()
    const a = seal('secret-password', publicRaw, 'cam-1')
    const b = seal('secret-password', publicRaw, 'cam-1')
    expect(a).not.toContain('secret-password')
    expect(Buffer.from(a.split('.')[4]!, 'base64url').toString()).not.toContain('secret')
    expect(a).not.toBe(b)
  })

  it('чужой закрытый ключ не вскрывает', () => {
    const { publicRaw } = agentKeys()
    const stranger = agentKeys()
    const sealed = seal('x', publicRaw, 'cam-1')
    expect(() => open(sealed, stranger.privateJwk, 'cam-1')).toThrow()
  })

  it('конверт одной камеры не подложить другой: контекст в AAD', () => {
    const { publicRaw, privateJwk } = agentKeys()
    const sealed = seal('x', publicRaw, 'cam-1')
    expect(() => open(sealed, privateJwk, 'cam-2')).toThrow()
  })

  it('испорченный шифртекст отвергается', () => {
    const { publicRaw, privateJwk } = agentKeys()
    const parts = seal('password', publicRaw, 'cam-1').split('.')
    const body = Buffer.from(parts[4]!, 'base64url')
    body[0] = body[0]! ^ 0xff
    parts[4] = body.toString('base64url')
    expect(() => open(parts.join('.'), privateJwk, 'cam-1')).toThrow()
  })

  it('ключ не той длины не принимается', () => {
    expect(() => x25519PublicKey(Buffer.alloc(16).toString('base64url'))).toThrow()
    expect(() => seal('x', 'не-ключ', 'cam-1')).toThrow()
  })
})
