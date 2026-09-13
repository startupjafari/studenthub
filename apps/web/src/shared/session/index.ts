// Клиентская часть сессии. RoleGuard/getServerSession (next/headers) импортируются
// напрямую из ./role-guard и ./server, чтобы не тянуть server-only код в клиентские бандлы.
export { establishSession, restoreSession, endSession, syncSessionUser } from './session'
export { SessionInitializer } from './session-initializer'
