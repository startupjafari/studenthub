import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Версия сборки попадает в бандл константой. После случая, когда сервисы на Railway
// разъехались по веткам и мини-апп неделю ходил в бэкенд без нужных маршрутов, вопрос
// «какая сборка у меня открыта» перестал быть праздным.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  // Относительный base: мини-апп раздаётся статикой и может жить не в корне домена
  // (например, /mini/), а Telegram открывает ровно тот URL, что задан в BotFather.
  base: './',
  server: {
    // Порты монорепо заняты по порядку: web 3000, api 3001, landing 3002.
    port: 3003,
    // host: true — чтобы тоннель (ngrok/cloudflared) видел dev-сервер: Telegram требует
    // https-адрес, локальный http://localhost он не откроет.
    host: true,
    // API проксируется через этот же dev-сервер — и это не удобство, а единственный
    // способ проверить мини-апп в Telegram: приложение открывается на телефоне, которому
    // localhost:3001 недоступен. Через прокси и страница, и запросы идут одним origin'ом
    // сквозь один туннель, поэтому CORS не участвует вовсе, а VITE_API_URL не нужен.
    proxy: {
      '/api': {
        target: process.env.MINI_APP_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // Vite 6 отвечает 403 на запрос с незнакомым заголовком Host — защита от DNS-rebinding.
    // Тоннель приходит именно с чужим хостом, поэтому домены тоннелей перечислены явно.
    // Точка в начале разрешает поддомены: у бесплатных тоннелей имя каждый раз новое.
    // Здесь только dev-сервер; прод раздаётся статикой, и этой настройки там нет.
    allowedHosts: [
      '.trycloudflare.com',
      '.ngrok-free.app',
      '.ngrok-free.dev',
      '.loca.lt',
      // pinggy и dev tunnels VS Code — ssh/https через 443. В сетях, где закрыт исходящий
      // 7844, cloudflared не поднимается вовсе, и рабочими остаются только они.
      '.pinggy.link',
      '.pinggy-free.link',
      '.pinggy.net',
      '.pinggy.online',
      '.devtunnels.ms',
      '.serveousercontent.com',
      '.lhr.life',
    ],
  },
})
