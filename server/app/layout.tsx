import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PROJECTLENS_PUBLIC_URL || 'https://projectlensai.vercel.app'),
  title: 'ProjectLens Cloud API: project health for your team and tools',
  description:
    'REST API for code quality, security, implementation progress and production readiness of GitHub and GitLab projects. Connect project-management tools, upload scans from VS Code, and run AI insights.',
  openGraph: {
    title: 'ProjectLens Cloud API',
    description: 'Project health - quality, security, progress and readiness - for your team and tools.',
    images: ['/logo.svg']
  }
};

export const viewport: Viewport = { themeColor: '#0b1119' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
