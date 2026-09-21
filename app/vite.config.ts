import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Относительный base: мини-апп раздаётся статикой и может жить не в корне домена
  // (например, /mini/), а Telegram открывает ровно тот URL, что задан в BotFather.
  base: './',
  server: {
    port: 5175,
    // host: true — чтобы тоннель (ngrok/cloudflared) видел dev-сервер: Telegram требует
    // https-адрес, локальный http://localhost он не откроет.
    host: true,
  },
})
