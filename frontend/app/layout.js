import './globals.css'

export const metadata = {
  title: 'Biosecurity · UCompensar',
  description: 'Sistema de control de acceso biométrico',
}

export const viewport = {
  themeColor: '#F05A22',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
