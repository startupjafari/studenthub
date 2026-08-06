import { QueryClient } from '@tanstack/react-query'

// Фабрика QueryClient: на сервере создаётся на каждый запрос, на клиенте — синглтон (см. providers).
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
