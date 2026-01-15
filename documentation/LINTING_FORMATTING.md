# Настройка ESLint и Prettier в StudentHub

## 📋 Обзор

В проекте StudentHub используются **ESLint** и **Prettier** для обеспечения единообразного стиля кода и выявления потенциальных ошибок.

---

## 🖥️ Backend (NestJS)

### Конфигурация ESLint

**Файл:** `.eslintrc.js`

**Основные настройки:**
- Парсер: `@typescript-eslint/parser`
- Плагины: `@typescript-eslint/eslint-plugin`
- Расширения:
  - `eslint:recommended` - базовые правила ESLint
  - `plugin:@typescript-eslint/recommended` - рекомендуемые правила TypeScript
  - `plugin:@typescript-eslint/recommended-requiring-type-checking` - правила с проверкой типов
  - `plugin:prettier/recommended` - интеграция с Prettier

**Ключевые правила:**
- `@typescript-eslint/no-explicit-any`: `warn` - предупреждение при использовании `any`
- `@typescript-eslint/no-unused-vars`: `warn` - предупреждение о неиспользуемых переменных
- `@typescript-eslint/no-floating-promises`: `error` - ошибка при необработанных промисах
- `no-console`: `warn` - предупреждение при использовании `console.log` (разрешены `console.warn` и `console.error`)

### Конфигурация Prettier

**Файл:** `.prettierrc`

**Настройки форматирования:**
```json
{
  "singleQuote": true,        // Одинарные кавычки
  "trailingComma": "all",    // Запятые в конце
  "tabWidth": 2,             // Размер отступа: 2 пробела
  "semi": true,              // Точка с запятой
  "printWidth": 100,         // Максимальная длина строки: 100 символов
  "arrowParens": "always",   // Скобки вокруг параметров стрелочных функций
  "endOfLine": "lf",         // Unix стиль окончания строк
  "bracketSpacing": true,    // Пробелы в объектах: { foo: bar }
  "bracketSameLine": false,  // Закрывающая скобка на новой строке
  "useTabs": false,          // Использовать пробелы, не табы
  "quoteProps": "as-needed"  // Кавычки в свойствах только при необходимости
}
```

### Игнорируемые файлы

**`.prettierignore`** - файлы, которые Prettier не будет форматировать:
- `node_modules`
- `dist`, `build`
- `.env` файлы
- Prisma migrations
- Docker файлы
- Сгенерированные файлы

**`.eslintignore`** - файлы, которые ESLint не будет проверять:
- `node_modules`
- `dist`, `build`
- Конфигурационные файлы
- Prisma
- Docker файлы

### Команды

```bash
# Форматирование кода
npm run format

# Проверка форматирования (без изменений)
npm run format:check

# Проверка линтера
npm run lint:check

# Исправление ошибок линтера
npm run lint

# Исправление линтера + форматирование
npm run lint:fix
```

---

## 🎨 Frontend (Next.js)

### Конфигурация ESLint

**Файл:** `.eslintrc.json` (или `eslint.config.js` для ESLint 9+)

**Рекомендуемая конфигурация для Next.js:**

```json
{
  "extends": [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2021,
    "sourceType": "module",
    "ecmaFeatures": {
      "jsx": true
    }
  },
  "plugins": ["@typescript-eslint", "react", "react-hooks"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ],
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}
```

### Конфигурация Prettier

**Файл:** `.prettierrc`

**Настройки (аналогично Backend):**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "semi": true,
  "printWidth": 100,
  "arrowParens": "always",
  "endOfLine": "lf",
  "bracketSpacing": true,
  "bracketSameLine": false
}
```

### Игнорируемые файлы

**`.prettierignore`:**
```
node_modules
.next
out
build
dist
*.tsbuildinfo
.env*
public
coverage
```

**`.eslintignore`:**
```
node_modules
.next
out
build
dist
public
```

### Команды

```bash
# Форматирование
npm run format

# Проверка форматирования
npm run format:check

# Линтинг
npm run lint

# Исправление
npm run lint:fix
```

---

## 🔧 Интеграция с IDE

### VS Code

**Настройки `.vscode/settings.json`:**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[json]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

**Рекомендуемые расширения:**
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript (`ms-vscode.vscode-typescript-next`)

### WebStorm / IntelliJ IDEA

1. **Настройка Prettier:**
   - Settings → Languages & Frameworks → JavaScript → Prettier
   - Указать путь к Prettier: `node_modules/prettier`
   - Включить "On code reformat" и "On save"

2. **Настройка ESLint:**
   - Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
   - Включить "Automatic ESLint configuration"
   - Включить "Run eslint --fix on save"

---

## 📝 Правила и рекомендации

### TypeScript

1. **Избегайте `any`:**
   ```typescript
   // ❌ Плохо
   function process(data: any) { }
   
   // ✅ Хорошо
   function process(data: unknown) { }
   // или
   interface ProcessData {
     id: string;
     name: string;
   }
   function process(data: ProcessData) { }
   ```

2. **Обрабатывайте промисы:**
   ```typescript
   // ❌ Плохо
   async function create() {
     this.service.create(); // Плавающий промис
   }
   
   // ✅ Хорошо
   async function create() {
     await this.service.create();
   }
   // или
   function create() {
     this.service.create().catch(console.error);
   }
   ```

3. **Используйте неиспользуемые переменные с префиксом `_`:**
   ```typescript
   // ✅ Хорошо
   function handler(_req: Request, res: Response) {
     res.send('OK');
   }
   ```

### React / Next.js

1. **Используйте React Hooks правильно:**
   ```typescript
   // ✅ Хорошо
   useEffect(() => {
     // эффект
   }, [dependency]); // Все зависимости указаны
   ```

2. **Отключайте правила только при необходимости:**
   ```typescript
   // ✅ Хорошо
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const data: any = fetchData();
   ```

---

## 🚀 Pre-commit hooks (опционально)

Для автоматической проверки перед коммитом можно использовать **Husky** и **lint-staged**:

**Установка:**
```bash
npm install --save-dev husky lint-staged
npx husky init
```

**`.lintstagedrc.json`:**
```json
{
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{json,md}": [
    "prettier --write"
  ]
}
```

**`.husky/pre-commit`:**
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

---

## ✅ Проверка настройки

### Backend

```bash
cd studenthub-backend

# Проверка ESLint
npm run lint:check

# Проверка Prettier
npm run format:check

# Исправление всего
npm run lint:fix
```

### Frontend

```bash
cd studenthub-frontend

# Проверка ESLint
npm run lint

# Проверка Prettier
npm run format:check

# Исправление
npm run lint:fix
```

---

## 📚 Дополнительные ресурсы

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [Prettier Documentation](https://prettier.io/docs/en/)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [NestJS Best Practices](https://docs.nestjs.com/)

---

## 🔍 Текущая конфигурация

### Backend

✅ **ESLint:** Настроен с TypeScript правилами  
✅ **Prettier:** Настроен с единообразным форматированием  
✅ **Интеграция:** ESLint и Prettier работают вместе  
✅ **Игнорирование:** Правильно настроены `.prettierignore` и `.eslintignore`  
✅ **Команды:** Добавлены команды для проверки и исправления

### Frontend

⚠️ **Требуется настройка:** Конфигурация будет создана при инициализации Frontend проекта

---

**Последнее обновление:** 2025-01-15
