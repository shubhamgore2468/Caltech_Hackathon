import { BackButton } from '@/components/BackButton';

export default function CohortPage() {
  return (
    <main className="min-h-screen bg-white p-8">
      <BackButton href="/doctor" />
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Cohort Analytics</h1>
      <p className="mt-2 text-sm text-slate-600">
        Aggregate distributions — requires n≥5 patients. Stream C1 builds this view.
      </p>
    </main>
  );
}
