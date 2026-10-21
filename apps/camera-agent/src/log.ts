// Журнал агента — строки JSON в stdout: их собирает Docker и любая система логов вуза.
// Токен, пароли камер и адреса с учётными данными сюда не попадают никогда: адреса потоков
// пишутся только через `redactUrl`.

type Level = 'info' | 'warn' | 'error'

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })
  ;(level === 'info' ? process.stdout : process.stderr).write(`${line}\n`)
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
}
