import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openCredentials, openSealed } from './sealed.js'

// Вектор выпущен кодом платформы (apps/api/src/common/crypto/sealed-box.ts → seal) на
// одноразовом ключе, созданном только для этого теста. Если формат на платформе изменится,
// а здесь нет, — тест упадёт раньше, чем агент перестанет открывать пароли камер.
const VECTOR = {
  privateJwk: {
    crv: 'X25519',
    d: 'sMACsCZXCjBzExQxpQ1o35LCA-rQdSSWgda0GUJHoUQ',
    x: 'zce4KROAjAZaiUp0-W94ChlndJKOmTYH41_xqoTv6UM',
    kty: 'OKP',
  },
  context: 'cam-vector',
  sealed:
    'v1.v_bZgrn-zFDppiRLEhw-uJRU0oyO7TFhLGKbyTpWrVc.yJhcsuQwg7qGRmX_.2AVbtK9y8BeI_R8VI2wFrQ.Hag61xYzXQQvSJ28IbcbczQqnnEskigo_TaQWwb6WdFaYgCbi2uqr1Jxczw8E6xf',
}

test('вскрывает конверт, запечатанный платформой', () => {
  assert.deepEqual(openCredentials(VECTOR.sealed, VECTOR.privateJwk, VECTOR.context), {
    username: 'admin',
    password: 'Пароль-1',
  })
})

test('конверт другой камеры не вскрывается', () => {
  assert.throws(() => openSealed(VECTOR.sealed, VECTOR.privateJwk, 'cam-other'))
})

test('испорченный конверт не вскрывается', () => {
  assert.throws(() =>
    openSealed(VECTOR.sealed.replace('v1.', 'v2.'), VECTOR.privateJwk, 'cam-vector'),
  )
  assert.throws(() =>
    openSealed(`${VECTOR.sealed.slice(0, -4)}AAAA`, VECTOR.privateJwk, 'cam-vector'),
  )
})
