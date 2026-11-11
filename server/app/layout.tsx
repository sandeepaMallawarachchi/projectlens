import type { ReactNode } from 'react';

export const metadata = { title: 'ProjectLens API', description: 'Remote repository analysis API' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#0f1720', color: '#e6edf3' }}>{children}</body>
    </html>
  );
}
