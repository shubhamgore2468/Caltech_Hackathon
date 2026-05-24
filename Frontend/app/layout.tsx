import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { MockDataBootstrap } from '@/components/MockDataBootstrap';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'NeuroTrack',
  description: "Parkinson's & dementia longitudinal monitoring platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <MockDataBootstrap />
        {process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true' && (
          <div className="bg-blue-800 px-4 py-1.5 text-center text-xs text-white">
            Demo mode · viewing synthetic patient data
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
