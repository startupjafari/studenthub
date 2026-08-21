// Токен ioredis-клиента — в отдельном файле, как MINIO_CLIENT в minio.constants.ts.
//
// Держать его в redis.module.ts нельзя: модуль импортирует провайдеры (CronLockService), а те
// импортируют токен обратно. Цикл рвётся не на сборке, а в рантайме: к моменту вычисления
// декоратора @Inject токен ещё undefined, и Nest не может собрать зависимость — падает подъём
// всего AppModule.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT')
