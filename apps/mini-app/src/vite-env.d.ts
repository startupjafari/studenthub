/// <reference types="vite/client" />

/**
 * Версия сборки. Подставляется `vite.config.ts` из package.json на этапе сборки —
 * читать package.json в рантайме нечем, а знать, какая сборка открыта, нужно: сервисы
 * на Railway однажды разъехались по веткам, и выяснилось это только по логам.
 */
declare const __APP_VERSION__: string
