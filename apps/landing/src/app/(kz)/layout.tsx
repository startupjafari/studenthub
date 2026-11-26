import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'
import { RootShell } from '../root-shell'
import { buildMetadata } from '../../config/metadata'

export const metadata: Metadata = buildMetadata('kk')

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
}

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell lang="kk">{children}</RootShell>
}
