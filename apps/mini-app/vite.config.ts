import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
    // Vite 6 отвечает 403 на запрос с незнакомым заголовком Host — защита от DNS-rebinding.
    // Тоннель приходит именно с чужим хостом, поэтому домены тоннелей перечислены явно.
    // Точка в начале разрешает поддомены: у бесплатных тоннелей имя каждый раз новое.
    // Здесь только dev-сервер; прод раздаётся статикой, и этой настройки там нет.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.loca.lt'],
  },
})
