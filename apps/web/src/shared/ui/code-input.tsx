'use client'

import * as React from 'react'

import { cn } from 'shared/lib/utils'

// Сегментированный ввод кода (пин-код): по одной ячейке на символ. Используется
// для 2FA — 6 цифр TOTP и 8 hex-символов резервного кода.
//
// Своя реализация, а не radix `unstable_OneTimePasswordField`: примитив помечен
// нестабильным (ломающие изменения без semver) и рассчитан на цифры, тогда как
// резервный код содержит буквы A–F. Новых зависимостей это не требует.

export type CodeAlphabet = 'numeric' | 'hex'

// Что разрешено вводить. hex — цифры и A–F в верхнем регистре (формат backup-кода).
const PATTERN: Record<CodeAlphabet, RegExp> = {
  numeric: /[^0-9]/g,
  hex: /[^0-9a-fA-F]/g,
}

export interface CodeInputProps {
  value: string
  onChange: (value: string) => void
  /** Количество ячеек = длина кода. */
  length: number
  alphabet?: CodeAlphabet
  /** Вызывается, когда введён последний символ (для автоотправки формы). */
  onComplete?: (value: string) => void
  /** Визуальный разрыв каждые N ячеек: 3 → «000 000», 4 → «0000 0000». */
  groupSize?: number
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  /** id первой ячейки — чтобы <Label htmlFor> вёл фокус в поле. */
  id?: string
  /** Доступное имя группы (обычно совпадает с текстом <Label>). */
  'aria-label'?: string
  className?: string
}

export function CodeInput({
  value,
  onChange,
  length,
  alphabet = 'numeric',
  onComplete,
  groupSize,
  disabled,
  invalid,
  autoFocus,
  id,
  'aria-label': ariaLabel,
  className,
}: CodeInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([])
  const chars = React.useMemo(
    () => normalize(value, alphabet, length).split(''),
    [value, alphabet, length],
  )

  // Автоотправку зовём один раз на полный код, иначе повторный render (или
  // проваленная проверка с тем же значением) дёргал бы submit снова.
  const completedRef = React.useRef<string | null>(null)

  function commit(next: string, focusIndex: number): void {
    const clean = normalize(next, alphabet, length)
    onChange(clean)
    focusCell(focusIndex)
    if (clean.length === length && completedRef.current !== clean) {
      completedRef.current = clean
      onComplete?.(clean)
    }
    if (clean.length < length) completedRef.current = null
  }

  function focusCell(index: number): void {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))]
    target?.focus()
    target?.select()
  }

  // Ввод в ячейку. Автозаполнение из SMS/менеджера паролей приходит целой строкой
  // в одно поле — тогда раскладываем её по ячейкам, начиная с текущей.
  function handleChange(index: number, raw: string): void {
    const typed = raw.replace(PATTERN[alphabet], '')
    if (!typed) return
    const upper = alphabet === 'hex' ? typed.toUpperCase() : typed
    const head = chars.slice(0, index).join('')
    commit(head + upper, index + upper.length)
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (chars[index]) {
        // Символ в текущей ячейке есть — стираем его, курсор остаётся.
        const next = [...chars]
        next[index] = ''
        commit(next.join('').slice(0, index), index)
      } else {
        // Ячейка пуста — стираем предыдущую и уходим влево.
        commit(chars.slice(0, Math.max(0, index - 1)).join(''), index - 1)
      }
      return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      commit(chars.slice(0, index).join(''), index)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusCell(index - 1)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusCell(index + 1)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusCell(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusCell(chars.length)
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>): void {
    e.preventDefault()
    // Из буфера часто прилетает код с пробелами или дефисами — разделители убираем.
    const pasted = e.clipboardData.getData('text').replace(PATTERN[alphabet], '')
    if (!pasted) return
    const upper = alphabet === 'hex' ? pasted.toUpperCase() : pasted
    const head = chars.slice(0, index).join('')
    commit(head + upper, index + upper.length)
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-1.5 sm:gap-2', className)}
    >
      {Array.from({ length }, (_, i) => (
        <React.Fragment key={i}>
          {/* Разрыв между группами: «000 000». Только визуальный, вне табуляции. */}
          {groupSize && i > 0 && i % groupSize === 0 && (
            <span aria-hidden className="w-1.5 shrink-0 sm:w-2.5" />
          )}
          <input
            ref={(el) => {
              refs.current[i] = el
            }}
            id={i === 0 ? id : undefined}
            // Один слот для автозаполнения на всю группу — иначе браузер предлагает
            // подстановку в каждую ячейку по отдельности.
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            // hex-код содержит буквы, поэтому цифровая клавиатура только для numeric.
            inputMode={alphabet === 'numeric' ? 'numeric' : 'text'}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            // maxLength=1 не ставим: автозаполнение целой строкой должно доехать
            // до onChange, где оно раскладывается по ячейкам.
            value={chars[i] ?? ''}
            aria-label={`${ariaLabel ?? ''} ${i + 1}/${length}`.trim()}
            aria-invalid={invalid || undefined}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              // Геометрия та же, что у Input (rounded-xl, border-input, синий фокус),
              // но ячейка квадратная и символ по центру. flex-1 + min-w-0 —
              // чтобы 8 ячеек влезали на узком экране без горизонтальной прокрутки.
              'h-12 min-w-0 flex-1 rounded-xl border border-input bg-background text-center text-lg font-semibold tabular-nums transition-[color,box-shadow,border-color] outline-none',
              'hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15',
              'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
              'aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15',
              'sm:h-14 sm:text-xl dark:bg-input/30 dark:disabled:bg-input/60',
              // Заполненная ячейка чуть контрастнее — видно прогресс ввода.
              chars[i] && 'border-ring/60',
            )}
          />
        </React.Fragment>
      ))}
    </div>
  )
}

function normalize(raw: string, alphabet: CodeAlphabet, length: number): string {
  const clean = raw.replace(PATTERN[alphabet], '').slice(0, length)
  return alphabet === 'hex' ? clean.toUpperCase() : clean
}
