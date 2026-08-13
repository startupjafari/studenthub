import { QueryClient } from '@tanstack/react-query'

// Фабрика QueryClient: на сервере создаётся на каждый запрос, на клиенте — синглтон (см. providers).
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // staleTime: свежие данные не рефетчим (мгновенно из кэша); фон-рефетч по истечении.
        staleTime: 60 * 1000,
        // gcTime 30 мин (по умолчанию было 5): часто посещаемые экраны (Сегодня, расписание,
        // чаты, уведомления) остаются в кэше между визитами → возврат мгновенный, без скелета.
        // Ощущение «приложение уже готово», а не «сайт грузит страницу» (Telegram-like UX).
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
