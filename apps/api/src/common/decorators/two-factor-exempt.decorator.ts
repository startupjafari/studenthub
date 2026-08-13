import { SetMetadata } from '@nestjs/common'

// Помечает эндпоинт как доступный привилегированной роли ДО включения 2FA
// (нужно, чтобы можно было настроить/включить 2FA, находясь под форсом). См. TwoFactorGuard.
export const TWO_FACTOR_EXEMPT = 'twoFactorExempt'
export const TwoFactorExempt = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TWO_FACTOR_EXEMPT, true)
