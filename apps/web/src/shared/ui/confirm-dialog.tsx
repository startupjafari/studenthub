'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from './button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  // Красная кнопка подтверждения для необратимых/деструктивных действий (удаление и т.п.).
  destructive?: boolean
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

// Системный (in-app) confirm вместо браузерного window.confirm — единый стиль во всём приложении.
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('Common')
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options ?? {})
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={opts !== null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        {opts && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{opts.title ?? t('confirmTitle')}</AlertDialogTitle>
              {opts.description && (
                <AlertDialogDescription>{opts.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {opts.cancelLabel ?? t('cancel')}
              </AlertDialogCancel>
              <Button
                variant={opts.destructive ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? t('confirmOk')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
