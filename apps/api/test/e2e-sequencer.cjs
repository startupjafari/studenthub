const Sequencer = require('@jest/test-sequencer').default

// Порядок e2e-файлов (--runInBand). Integration-тесты (реальный MinIO + pure-ESM file-type,
// импортируемый динамически) ставим ПЕРВЫМИ. Их ленивый import() под
// Jest --experimental-vm-modules становится нестабильным, если перед ними уже разрушались
// окружения других suite'ов (наблюдалось "import after teardown"); запуск первыми — до любых
// teardown'ов — делает импорт детерминированно успешным.
class E2ESequencer extends Sequencer {
  sort(tests) {
    const rank = (t) => (t.path.includes('integration') ? 0 : 1)
    return Array.from(tests).sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
  }
}

module.exports = E2ESequencer
