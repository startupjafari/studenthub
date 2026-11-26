// Клиент NCALayer — десктопного приложения НУЦ РК, через которое браузер подписывает ключом ЭЦП
// (docs/PROJECT.md §8.3 «Вход по ЭЦП»). Своя маленькая реализация вместо ncalayer-js-client:
// из протокола нужна одна операция — открепленная CMS-подпись ключом аутентификации.
//
// Протокол (сверено с github.com/sigex-kz/ncalayer-js-client и вики модуля
// github.com/pkigovkz/sdkinfo/wiki/KNCA-Basics-Module):
//
// 1. WebSocket на wss://127.0.0.1:13579. Сертификат localhost ставит сам NCALayer.
// 2. Сразу после подключения NCALayer присылает приветствие `{ result: { version } }` —
//    только после него можно слать запросы.
// 3. Запрос `{ module: 'kz.gov.pki.knca.basics', method: 'sign', args }`. Ответ модуля basics
//    всегда несёт `status`: `{ status: true, body: { result } }` — подпись (строка или массив),
//    `{ status: true, body: {} }` — человек закрыл окно, `{ status: false, code, message }` —
//    ошибка. Ответ без `status` значит, что запрос разобрал не модуль basics, а ядро старой
//    версии NCALayer, где такого модуля нет.
//
// Одна операция за раз: два окна выбора ключа поверх друг друга NCALayer не держит, а второй
// ответ пришёл бы в чужой обработчик. Сокет закрывается после каждой операции.

export const NCALAYER_URL = 'wss://127.0.0.1:13579'
/** Официальная страница загрузки NCALayer (pki.gov.kz/ncalayer/ переадресует сюда же). */
export const NCALAYER_DOWNLOAD_URL = 'https://ncl.pki.gov.kz/'

const BASICS_MODULE = 'kz.gov.pki.knca.basics'
/**
 * Хранилища, которые выдаёт НУЦ: файл PKCS#12 и аппаратные токены, включая удостоверение
 * личности. JKS не берём — НУЦ ключи в нём не выпускает.
 */
const AUTH_KEY_STORAGES = [
  'PKCS12',
  'AKKaztokenStore',
  'AKKZIDCardStore',
  'AKEToken72KStore',
  'AKEToken5110Store',
  'AKJaCartaStore',
  'AKAKEYStore',
]
/**
 * Сколько ждать приветствия NCALayer. Не запущенный NCALayer отказывает в соединении сразу,
 * а вот браузер, спрашивающий разрешение на доступ к локальным адресам, держит соединение,
 * пока человек не ответит, — даём ему на это время.
 */
const CONNECT_TIMEOUT_MS = 10_000

export type NcaLayerErrorKind =
  /** Соединение не установлено: NCALayer не запущен, не установлен или не ответил вовремя. */
  | 'not-running'
  /** Браузер запретил странице обращаться к локальным адресам (Local Network Access). */
  | 'blocked'
  /** Человек закрыл окно выбора ключа или отменил операцию на нашей стороне. */
  | 'cancelled'
  /** Версия NCALayer без модуля kz.gov.pki.knca.basics — нужно обновить. */
  | 'outdated'
  /** NCALayer ответил ошибкой (неверный пароль ключа и т.п.) или оборвал соединение. */
  | 'failed'
  /** Уже идёт другая операция с NCALayer. */
  | 'busy'

export class NcaLayerError extends Error {
  readonly kind: NcaLayerErrorKind

  /** `detail` — для журнала и отладки; пользователю показывается текст по `kind`. */
  constructor(kind: NcaLayerErrorKind, detail?: string) {
    super(detail ? `NCALayer ${kind}: ${detail}` : `NCALayer ${kind}`)
    this.name = 'NcaLayerError'
    this.kind = kind
  }
}

export function isNcaLayerError(error: unknown): error is NcaLayerError {
  return error instanceof NcaLayerError
}

/** Подмножество WebSocket, которым пользуется клиент, — в тестах подменяется фейком. */
export interface NcaLayerSocket {
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

export type NcaLayerSocketFactory = (url: string) => NcaLayerSocket

export interface NcaLayerOptions {
  url?: string
  connectTimeoutMs?: number
  createSocket?: NcaLayerSocketFactory
  /** Отмена с нашей стороны: сокет закрывается, ожидание завершается ошибкой `cancelled`. */
  signal?: AbortSignal
  /** Состояние разрешения на доступ к локальным адресам; по умолчанию — Permissions API. */
  localAccessState?: () => Promise<PermissionState | null>
}

export interface NcaLayerSession {
  /** Версия из приветствия NCALayer. */
  readonly version: string
  /**
   * Открепленная CMS-подпись ключом аутентификации над байтами `dataBase64`.
   * Возвращает подпись в base64.
   */
  signAuth(dataBase64: string, locale: string): Promise<string>
  close(): void
}

/**
 * Язык окна NCALayer. Модуль basics знает только `kk` и `ru` (без параметра — казахский);
 * английского интерфейса у окна нет, англоязычному пользователю показываем русский.
 */
export function ncaLayerLocale(locale: string): 'kk' | 'ru' {
  return locale === 'kk' ? 'kk' : 'ru'
}

/**
 * Есть ли на этом устройстве NCALayer в принципе: он существует только для Windows, macOS и
 * Linux. На телефоне и планшете кнопка подписи ведёт в тупик — её не показывают.
 */
export function isNcaLayerPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return false
  // iPadOS 13+ представляется маком; настоящий macOS отдаёт maxTouchPoints === 0.
  return !(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// Идёт ли сейчас операция с NCALayer — на всё приложение, а не на один компонент.
let activeSession = false

/**
 * Подключиться к NCALayer и дождаться приветствия. Бросает `NcaLayerError`:
 * `not-running`, `blocked`, `busy`, `cancelled` (по `signal`), `failed` (на порту ответил
 * кто-то, кроме NCALayer). Сессию обязательно закрыть — `close()` или через `withNcaLayer`.
 */
export async function openNcaLayer(options: NcaLayerOptions = {}): Promise<NcaLayerSession> {
  if (activeSession) throw new NcaLayerError('busy')
  if (options.signal?.aborted) throw new NcaLayerError('cancelled')
  activeSession = true
  try {
    return await connect(options)
  } catch (error) {
    activeSession = false
    throw error
  }
}

/** Открыть сессию, выполнить `run` и закрыть сокет в любом исходе. */
export async function withNcaLayer<T>(
  run: (session: NcaLayerSession) => Promise<T>,
  options: NcaLayerOptions = {},
): Promise<T> {
  const session = await openNcaLayer(options)
  try {
    return await run(session)
  } finally {
    session.close()
  }
}

export interface SignedChallenge {
  challengeId: string
  cms: string
}

/**
 * Весь путь подписи challenge для входа или привязки: подключиться к NCALayer, взять
 * challenge у сервера, подписать и закрыть сокет.
 *
 * Challenge запрашивается ПОСЛЕ приветствия NCALayer: если NCALayer не запущен, человек
 * узнает об этом сразу, а сервер не выдаёт одноразовых challenge, которые никто не подпишет.
 * Ошибки запроса challenge уходят наружу как есть (`{ code, message }` интерцептора).
 */
export async function signChallengeWithNcaLayer(
  requestChallenge: () => Promise<{ challengeId: string; nonce: string }>,
  options: NcaLayerOptions & {
    locale: string
    /** Окно выбора ключа вот-вот откроется — пора сказать человеку, где его искать. */
    onAwaitingKey?: () => void
  },
): Promise<SignedChallenge> {
  return withNcaLayer(async (session) => {
    const challenge = await requestChallenge()
    if (options.signal?.aborted) throw new NcaLayerError('cancelled')
    options.onAwaitingKey?.()
    const cms = await session.signAuth(challenge.nonce, options.locale)
    return { challengeId: challenge.challengeId, cms }
  }, options)
}

function connect(options: NcaLayerOptions): Promise<NcaLayerSession> {
  const url = options.url ?? NCALAYER_URL
  const createSocket = options.createSocket ?? defaultSocket
  const timeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const localAccessState = options.localAccessState ?? queryLocalAccessState
  const signal = options.signal

  return new Promise<NcaLayerSession>((resolve, reject) => {
    let socket: NcaLayerSocket
    try {
      socket = createSocket(url)
    } catch (error) {
      // CSP или битый адрес: конструктор WebSocket бросает синхронно.
      reject(new NcaLayerError('not-running', errorText(error)))
      return
    }

    // Ждём приветствия NCALayer — до него запросы слать нельзя.
    let connecting = true
    let closed = false
    // Ожидающий ответа запрос подписи: на сокете в каждый момент не больше одного.
    let pending: { resolve: (cms: string) => void; reject: (error: NcaLayerError) => void } | null =
      null

    const shutdown = (): void => {
      if (closed) return
      closed = true
      activeSession = false
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        // Сокет уже закрыт — закрывать нечего.
      }
    }

    // Соединение не состоялось. Прежде чем сказать «NCALayer не запущен», спрашиваем
    // браузер, не он ли запретил странице доступ к локальным адресам.
    const failConnect = (detail: string): void => {
      if (!connecting) return
      connecting = false
      shutdown()
      void localAccessState()
        .catch(() => null)
        .then((state) =>
          reject(new NcaLayerError(state === 'denied' ? 'blocked' : 'not-running', detail)),
        )
    }

    const failPending = (error: NcaLayerError): void => {
      const current = pending
      pending = null
      shutdown()
      current?.reject(error)
    }

    const onAbort = (): void => {
      if (!connecting) {
        failPending(new NcaLayerError('cancelled'))
        return
      }
      connecting = false
      shutdown()
      reject(new NcaLayerError('cancelled'))
    }

    const signAuth = (dataBase64: string, locale: string): Promise<string> => {
      if (closed) return Promise.reject(new NcaLayerError('failed', 'session closed'))
      if (pending) return Promise.reject(new NcaLayerError('busy'))
      return new Promise<string>((resolveSign, rejectSign) => {
        pending = { resolve: resolveSign, reject: rejectSign }
        try {
          socket.send(JSON.stringify(authSignRequest(dataBase64, locale)))
        } catch (error) {
          failPending(new NcaLayerError('failed', errorText(error)))
        }
      })
    }

    // Объявлен здесь, а не выше: замыкания выше читают его только после этой строки.
    const timer = setTimeout(() => failConnect('timeout'), timeoutMs)
    signal?.addEventListener('abort', onAbort)

    // Ошибку почти всегда сопровождает close — что придёт первым, то и решает.
    socket.onerror = () => {
      if (connecting) failConnect('socket error')
      else failPending(new NcaLayerError('failed', 'socket error'))
    }
    socket.onclose = () => {
      if (connecting) failConnect('closed before greeting')
      else failPending(new NcaLayerError('failed', 'connection closed'))
    }
    socket.onmessage = (event) => {
      const message = parse(event.data)
      if (connecting) {
        connecting = false
        clearTimeout(timer)
        const version = greetingVersion(message)
        if (version === null) {
          // На порту NCALayer ответил кто-то другой — работать с ним нельзя.
          shutdown()
          reject(new NcaLayerError('failed', 'unexpected greeting'))
          return
        }
        resolve({ version, signAuth, close: shutdown })
        return
      }
      const current = pending
      if (!current) return
      pending = null
      const outcome = readSignResponse(message)
      if (typeof outcome === 'string') current.resolve(outcome)
      else current.reject(outcome)
    }
  })
}

/** Запрос подписи: открепленная CMS над байтами из base64, ключ — только аутентификации. */
function authSignRequest(dataBase64: string, locale: string) {
  return {
    module: BASICS_MODULE,
    method: 'sign',
    args: {
      allowedStorages: AUTH_KEY_STORAGES,
      format: 'cms',
      data: dataBase64,
      // decode — подписать байты nonce, а не его base64-текст; encapsulate: false — подпись
      // открепленная, сервер проверяет её над тем же nonce. tsaProfile не передаём: метка
      // времени для входа не нужна, а с ней NCALayer ходил бы ещё и в tsp.pki.gov.kz.
      signingParams: { decode: true, encapsulate: false, digested: false },
      // chain: [] — построение цепочки на стороне NCALayer необязательно: так выбираются и
      // тестовые ключи НУЦ на тестовом стенде. Цепочку, срок и отзыв проверяет сервер.
      // extKeyUsageOids: [] — ключи по назначению не фильтруем. Единый ключ ГОСТ 2015, который
      // НУЦ выдаёт с 2023 года, годится и для входа, но clientAuth в нём нет: фильтр по нему
      // спрятал бы почти все действующие ключи. Годность ключа для входа решает сервер
      // (isAuthenticationKey в ncanode-eds-verifier.ts) и отвечает EDS_CERT_NOT_AUTH.
      signerParams: { extKeyUsageOids: [], chain: [] },
      locale: ncaLayerLocale(locale),
    },
  }
}

function readSignResponse(message: unknown): string | NcaLayerError {
  if (!isRecord(message)) return new NcaLayerError('failed', 'malformed response')
  // Без status ответил не модуль basics, а ядро NCALayer: модуля в этой версии нет.
  if (!('status' in message)) {
    return new NcaLayerError('outdated', describeCode(message))
  }
  if (message.status !== true) return new NcaLayerError('failed', describeCode(message))
  const body = isRecord(message.body) ? message.body : {}
  if (!('result' in body)) return new NcaLayerError('cancelled')
  const result = Array.isArray(body.result) ? body.result[0] : body.result
  if (typeof result !== 'string' || result.length === 0) {
    return new NcaLayerError('failed', 'empty signature')
  }
  return result
}

function greetingVersion(message: unknown): string | null {
  if (!isRecord(message) || !isRecord(message.result)) return null
  const { version } = message.result
  return typeof version === 'string' && version.length > 0 ? version : null
}

function parse(data: unknown): unknown {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeCode(message: Record<string, unknown>): string {
  const code = message.code ?? message.errorCode
  const text = message.message
  return [code, text].filter((part) => typeof part === 'string' && part).join(': ') || 'error'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultSocket(url: string): NcaLayerSocket {
  return new WebSocket(url) as unknown as NcaLayerSocket
}

/**
 * Разрешение браузера на доступ к локальным адресам (Chrome, Local Network Access). Имя
 * разрешения менялось: сначала пробуем новое `loopback-network`, затем прежнее. Браузер без
 * такой проверки — `null`.
 */
async function queryLocalAccessState(): Promise<PermissionState | null> {
  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
  if (!permissions?.query) return null
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const status = await permissions.query({ name: name as PermissionName })
      return status.state
    } catch {
      // Браузер не знает такого разрешения — пробуем следующее имя.
    }
  }
  return null
}
