#!/usr/bin/env node
// Туннель для проверки мини-аппа в Telegram + автоматическая перерегистрация кнопки бота.
//
// Зачем скрипт, а не команда в терминале. Telegram открывает только https, поэтому
// dev-сервер выставляется наружу туннелем. Бесплатный туннель живёт минутами и при каждом
// переподключении выдаёт НОВЫЙ адрес, а в боте остаётся старый — приложение перестаёт
// открываться, и выглядит это как «сломался мини-апп». Руками адрес не наупдешься.
//
// Скрипт держит ssh-туннель, ловит выданный адрес и сам прописывает его в кнопку меню бота
// через Bot API (`setChatMenuButton`). Оборвалась сессия — поднимается заново, новый адрес
// прописывается снова. Со стороны пользователя ничего не меняется: кнопка в чате всегда
// ведёт на живой адрес.
//
// Токен читается из окружения или из apps/mini-app/.env (в git не попадает).

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const PORT = Number(process.env.MINI_APP_PORT ?? 3003)
const BUTTON_TEXT = process.env.MINI_APP_BUTTON_TEXT ?? 'Открыть StudentHub'
// Порядок как у Vite: .env.local перекрывает .env. Токен кладут то туда, то сюда —
// читаем оба, чтобы «нет токена» не встречало там, где он лежит рядом.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILES = [resolve(APP_DIR, '.env.local'), resolve(APP_DIR, '.env')]

// localhost.run — единственный из бесплатных туннелей, который отдаёт страницу сразу.
// pinggy и serveo показывают браузеру предупреждение, а переход по кнопке «продолжить»
// теряет фрагмент адреса — вместе с ним теряется initData, ради которого всё и нужно.
const SSH_ARGS = [
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'ExitOnForwardFailure=yes',
  // Обрыв замечаем за минуту, а не висим в мёртвой сессии.
  '-o',
  'ServerAliveInterval=20',
  '-o',
  'ServerAliveCountMax=3',
  '-R',
  `80:localhost:${PORT}`,
  'nokey@localhost.run',
]

const URL_RE = /https:\/\/[a-z0-9-]+\.lhr\.life/i

function token() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN

  for (const file of ENV_FILES) {
    try {
      const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('TELEGRAM_BOT_TOKEN='))
      const value = line
        ?.slice('TELEGRAM_BOT_TOKEN='.length)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (value) return value
    } catch {
      // Файла может не быть — это норма, пробуем следующий.
    }
  }
  return null
}

async function devServerAlive() {
  try {
    const response = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

/** Прописывает адрес в кнопку меню бота. Ошибку показываем целиком — она объясняет причину. */
async function setMenuButton(botToken, url) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      menu_button: { type: 'web_app', text: BUTTON_TEXT, web_app: { url } },
    }),
  })
  const body = await response.json()
  if (!body.ok) throw new Error(`${body.error_code}: ${body.description}`)
}

function startTunnel(onUrl, onExit) {
  const ssh = spawn('ssh', SSH_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] })
  const seen = new Set()

  for (const stream of [ssh.stdout, ssh.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      const match = URL_RE.exec(line)
      if (match && !seen.has(match[0])) {
        seen.add(match[0])
        onUrl(match[0])
      }
    })
  }

  ssh.on('exit', (code) => onExit(code))
  return ssh
}

async function main() {
  const botToken = token()
  if (!botToken) {
    console.error(
      `Нет токена бота. Положи его в ${ENV_FILES[0]} (или .env рядом):\n\n` +
        '  TELEGRAM_BOT_TOKEN=123456:AA...\n\n' +
        'Токен даёт @BotFather при /newbot. Оба файла в git не попадают.',
    )
    process.exit(1)
  }

  if (!(await devServerAlive())) {
    console.error(
      `Dev-сервер не отвечает на http://localhost:${PORT}.\n` +
        'Запусти его в соседнем терминале: pnpm --filter mini-app dev',
    )
    process.exit(1)
  }

  let stopping = false

  const run = () => {
    console.log('Поднимаю туннель…')
    const ssh = startTunnel(
      async (url) => {
        console.log(`\nАдрес: ${url}`)
        try {
          await setMenuButton(botToken, url)
          console.log(`Кнопка «${BUTTON_TEXT}» в боте обновлена — открывай чат с ботом.\n`)
        } catch (error) {
          console.error(`Не удалось обновить кнопку бота: ${error.message}\n`)
        }
      },
      (code) => {
        if (stopping) return
        console.log(`Туннель оборвался (код ${code}) — переподключаюсь через 3 с…`)
        setTimeout(run, 3000)
      },
    )

    const stop = () => {
      stopping = true
      ssh.kill()
      console.log('\nТуннель закрыт. Кнопка бота осталась на мёртвом адресе — это нормально,')
      console.log('при следующем запуске скрипт пропишет новый.')
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }

  run()
}

await main()
