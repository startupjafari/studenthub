import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

// Снимает глобальный JwtAuthGuard с эндпоинта. Список публичных строго ограничен (§6.1).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
