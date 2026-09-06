import type { Metadata } from 'next';
import { Providers } from '@components';
import './globals.css';

export const metadata: Metadata = { title: 'mc-panel' };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
