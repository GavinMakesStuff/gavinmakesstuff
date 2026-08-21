import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Anami',
  description: "Anami — today's world",
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
