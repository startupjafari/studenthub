// DI-токен MinIO-клиента вынесен отдельно, чтобы модуль и сервисы могли
// импортировать его без циклической зависимости между minio.module и сервисами.
export const MINIO_CLIENT = Symbol('MINIO_CLIENT')
