'use client';

import { useState } from 'react';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import { extractMotionBiomarkers, generateMockSamples, type MotionMode } from '@/lib/biomarkers/motion';
import type { Biomarker, Sample } from '@/lib/types';
import { DEMO_PATIENT_ID } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

type CaptureSource = 'phone' | 'mock';

export default function TestPage() {
  const [mode, setMode] = useState<MotionMode>('hand_tremor');
  const [source, setSource] = useState<CaptureSource>('mock');
  const [biomarkers, setBiomarkers] = useState<Biomarker[] | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);

  const duration = mode === 'walk_test' ? 30 : 15;

  function handleSamples(s: Sample[]) {
    setSamples(s);
    const bms = extractMotionBiomarkers(s, mode);
    setBiomarkers(bms);
    setPostResult(null);
  }

  function runMock() {
    const tremorHz = mode === 'hand_tremor' ? 5 : 2;
    const tremorAmp = mode === 'hand_tremor' ? 1.8 : 0.6;
    const s = generateMockSamples({ durationSec: duration, tremorHz, tremorAmp });
    handleSamples(s);
  }

  async function persist() {
    if (!biomarkers || biomarkers.length === 0) return;
    setPosting(true);
    setPostResult(null);
    try {
      // 1. create session
      const sessionRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: DEMO_PATIENT_ID, mode }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.text();
        throw new Error(`session create failed: ${err}`);
      }
      const session = await sessionRes.json();

      // 2. batch biomarkers
      const bmRes = await fetch('/api/biomarkers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, biomarkers }),
      });
      if (!bmRes.ok) {
        const err = await bmRes.text();
        throw new Error(`biomarker insert failed: ${err}`);
      }
      const bmJson = await bmRes.json();

      // 3. end session
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      setPostResult(`Saved session ${session.id.slice(0, 8)}… (${bmJson.inserted} biomarkers)`);
    } catch (e) {
      setPostResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPosting(false);
    }
  }

  function reset() {
    setBiomarkers(null);
    setSamples(null);
    setPostResult(null);
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Motion Test</h1>

      <Tabs value={mode} onValueChange={(v) => { setMode(v as MotionMode); reset(); }}>
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="hand_tremor">Hand Tremor (15s)</TabsTrigger>
          <TabsTrigger value="walk_test">Walk (30s)</TabsTrigger>
        </TabsList>

        <TabsContent value="hand_tremor" className="mt-3">
          <p className="text-sm text-zinc-400">
            Hold phone still in dominant hand. Rest elbow on a surface.
          </p>
        </TabsContent>
        <TabsContent value="walk_test" className="mt-3">
          <p className="text-sm text-zinc-400">
            Put phone in front pocket. Walk normally for 30 seconds.
          </p>
        </TabsContent>
      </Tabs>

      <div className="flex gap-2">
        <Button
          variant={source === 'mock' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setSource('mock'); reset(); }}
        >
          Mock (laptop)
        </Button>
        <Button
          variant={source === 'phone' ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => { setSource('phone'); reset(); }}
        >
          Phone sensor
        </Button>
      </div>

      {source === 'mock' ? (
        <Card>
          <CardContent className="pt-4 flex flex-col gap-3">
            <p className="text-sm text-zinc-400">
              Generates a fake {mode === 'hand_tremor' ? '~5Hz tremor' : '~2Hz gait'} signal for {duration}s. Use this on laptop to test the pipeline without a phone.
            </p>
            <Button onClick={runMock} className="w-full">
              Generate mock {duration}s capture
            </Button>
          </CardContent>
        </Card>
      ) : (
        <MotionCapture mode={mode} durationSec={duration} onComplete={handleSamples} />
      )}

      {biomarkers && biomarkers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Biomarkers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400">
              {samples?.length.toLocaleString()} samples
            </div>
            {biomarkers.map((b) => (
              <div key={b.metric_name} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">{b.metric_name}</span>
                <Badge variant="secondary" className="tabular-nums">
                  {b.value.toFixed(3)}{b.unit ? ` ${b.unit}` : ''}
                </Badge>
              </div>
            ))}
            <Button
              onClick={persist}
              disabled={posting}
              variant="default"
              className="mt-2"
            >
              {posting ? 'Saving…' : 'Save to database'}
            </Button>
            {postResult && (
              <div className={`text-xs ${postResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                {postResult}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
