import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { AgentPrincipal } from './agent-auth.guard'

/** Агент из AgentAuthGuard. Только на маршрутах под этим guard'ом. */
export const CurrentAgent = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AgentPrincipal =>
    ctx.switchToHttp().getRequest<{ cameraAgent: AgentPrincipal }>().cameraAgent,
)
