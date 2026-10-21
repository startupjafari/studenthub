// Настройки агента — только из переменных окружения: их задаёт тот, кто запускает
// контейнер в вузе. Ошибка в настройках — остановка с понятным сообщением, а не работа
// «как-нибудь».

export interface AgentConfig {
  /** Адрес API платформы с префиксом: https://api.studenthub.kz/api/v1 */
  apiUrl: string
  token: string
  /** Каталог для закрытого ключа агента. Должен переживать пересоздание контейнера. */
  stateDir: string
  /** Как часто проверять доступность камер. */
  probeIntervalMs: number
}

const TOKEN_PREFIX = 'shca_'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const apiUrl = (env.STUDENTHUB_API_URL ?? '').replace(/\/+$/, '')
  const token = env.STUDENTHUB_AGENT_TOKEN ?? ''
  if (!apiUrl) throw new Error('Не задан STUDENTHUB_API_URL — адрес API платформы')
  if (!/^https?:\/\//.test(apiUrl))
    throw new Error('STUDENTHUB_API_URL должен быть http(s)-адресом')
  // Токен и состояние камер идут только по TLS. http — лишь для стенда разработчика, и
  // только если это сказано явно: случайно пустить токен открытым текстом нельзя.
  if (apiUrl.startsWith('http://') && env.STUDENTHUB_ALLOW_INSECURE !== '1') {
    throw new Error(
      'STUDENTHUB_API_URL должен начинаться с https:// (http — только при STUDENTHUB_ALLOW_INSECURE=1)',
    )
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error(
      'STUDENTHUB_AGENT_TOKEN не похож на токен агента: возьмите его в разделе «Камеры»',
    )
  }
  const probeSeconds = Number(env.STUDENTHUB_PROBE_INTERVAL_S ?? '60')
  if (!Number.isFinite(probeSeconds) || probeSeconds < 10) {
    throw new Error('STUDENTHUB_PROBE_INTERVAL_S — число секунд, не меньше 10')
  }
  return {
    apiUrl,
    token,
    stateDir: env.STUDENTHUB_STATE_DIR ?? '/var/lib/studenthub-agent',
    probeIntervalMs: probeSeconds * 1000,
  }
}
