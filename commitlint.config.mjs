// Conventional Commits + правило §16: scope обязателен для feat и fix.
// Заголовок ≤ 100 символов. Русскоязычный subject допускается.
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'scope-required-for-feat-fix': ({ type, scope }) => {
          if ((type === 'feat' || type === 'fix') && !scope) {
            return [false, `scope обязателен для "${type}" — например: ${type}(auth): описание`]
          }
          return [true]
        },
      },
    },
  ],
  rules: {
    'scope-required-for-feat-fix': [2, 'always'],
    'header-max-length': [2, 'always', 100],
    // subject на русском — не навязываем регистр
    'subject-case': [0],
  },
}
