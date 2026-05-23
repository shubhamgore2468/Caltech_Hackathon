import Link from 'next/link';
import { BackButton } from '@/components/BackButton';

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-white p-8">
      <div className="absolute left-6 top-6">
        <BackButton />
      </div>
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">NeuroTrack</h1>
        <p className="mt-2 text-slate-600">
          Parkinson&apos;s &amp; dementia longitudinal monitoring for the Caltech Longevity Hackathon
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/patient"
            className="rounded-lg bg-blue-800 px-6 py-3 text-sm font-medium text-white hover:bg-blue-900"
          >
            Patient Portal
          </Link>
          <Link
            href="/doctor"
            className="rounded-lg border border-slate-200 px-6 py-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Doctor Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
