'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CodeInput, Label } from '../../../shared/ui'

// Длины кодов заданы сервером: TOTP — 6 цифр, резервный — 8 hex-символов
// (two-factor.service.ts: /^\d{6}$/ → TOTP, иначе сверка с резервными кодами).
const TOTP_LENGTH = 6
const BACKUP_LENGTH = 8

/**
 * Подтверждение действия своим кодом 2FA — так же, как второй шаг входа (features/login,
 * TwoFactorStep): шесть ячеек кода из приложения, а по ссылке — восемь ячеек резервного кода.
 * У форматов разные длина и алфавит, поэтому режимы, а не одно поле.
 *
 * `onChange` отдаёт и значение, и готов ли код: полная длина зависит от режима, и снаружи
 * её не угадать. `resetKey` пересоздаёт ячейки — после неверного кода фокус встаёт в первую.
 */
export function SecondFactorCodeField({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus = true,
  resetKey = 0,
}: {
  id: string
  value: string
  onChange: (value: string, complete: boolean) => void
  /** Введён последний символ — для автоотправки, как на входе. */
  onComplete?: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  resetKey?: number
}) {
  const t = useTranslations('Auth')
  const [backupMode, setBackupMode] = useState(false)
  const length = backupMode ? BACKUP_LENGTH : TOTP_LENGTH
  const label = backupMode ? t('twoFactorBackupCodeLabel') : t('twoFactorCodeLabel')

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <CodeInput
        // key — чтобы при смене режима и после неверной попытки ячейки пересоздались и
        // фокус встал в первую.
        key={`${backupMode ? 'backup' : 'totp'}-${resetKey}`}
        id={id}
        aria-label={label}
        value={value}
        onChange={(next) => onChange(next, next.length === length)}
        length={length}
        onComplete={onComplete}
        alphabet={backupMode ? 'hex' : 'numeric'}
        groupSize={backupMode ? 4 : 3}
        disabled={disabled}
        // Красная рамка — только пока поле пусто после ошибки: начал вводить — снялась.
        invalid={invalid && value.length === 0}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        onClick={() => {
          setBackupMode((v) => !v)
          onChange('', false)
        }}
        disabled={disabled}
        className="cursor-pointer self-start rounded text-xs text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
      >
        {backupMode ? t('twoFactorUseAppHint') : t('twoFactorBackupHint')}
      </button>
    </div>
  )
}
