import type { ReactNode } from 'react';

export const metadata = {
  title: 'Worker Manager + Next.js (App Router)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
