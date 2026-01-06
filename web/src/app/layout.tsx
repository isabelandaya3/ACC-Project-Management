import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ACC Integration MVP',
  description: 'Autodesk Construction Cloud Integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
