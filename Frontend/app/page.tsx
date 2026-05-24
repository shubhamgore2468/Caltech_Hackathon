'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { LiquidButton } from '@/components/ui/button';

const SERIF = 'var(--font-serif), Georgia, serif';

const HERO_KEYWORDS = [
  'peace of mind',
  'early detection',
  'tremor tracking',
  'staying independent',
] as const;

/* ─── hero leaf shapes (Sonia-style interactive blobs) ─────────────────── */

const LEAVES = [
  {
    pos: { top: '-80px', left: '-70px' },
    w: 360, h: 460,
    color: '#A8D5BA',
    rotate: -22,
    rx: '63% 37% 30% 70% / 50% 40% 60% 50%',
  },
  {
    pos: { top: '80px', left: '-45px' },
    w: 270, h: 340,
    color: '#9FBBE0',
    rotate: 28,
    rx: '40% 60% 65% 35% / 55% 45% 55% 45%',
  },
  {
    pos: { top: '-55px', right: '-55px' },
    w: 310, h: 410,
    color: '#C8B4D8',
    rotate: 18,
    rx: '55% 45% 40% 60% / 45% 55% 45% 55%',
  },
  {
    pos: { bottom: '-50px', right: '-40px' },
    w: 285, h: 370,
    color: '#9FBBE0',
    rotate: -28,
    rx: '45% 55% 60% 40% / 60% 40% 55% 45%',
  },
  {
    pos: { bottom: '-35px', left: '18%' },
    w: 260, h: 210,
    color: '#E8D5BA',
    rotate: 52,
    rx: '40% 60% 30% 70% / 60% 40% 70% 30%',
  },
] as const;

function HeroLeaves() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {LEAVES.map((leaf, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            ...leaf.pos,
            width: leaf.w,
            height: leaf.h,
            transform: `rotate(${leaf.rotate}deg)`,
            transformOrigin: 'center',
            pointerEvents: 'auto',
          }}
          className="group"
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: leaf.color,
              borderRadius: leaf.rx,
              opacity: 0.18,
              transition: 'opacity 0.55s ease, transform 0.55s ease',
              filter: 'blur(0.5px)',
            }}
            className="group-hover:opacity-[0.44] group-hover:scale-[1.03]"
          />
        </div>
      ))}
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function FadeUp({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── page ─────────────────────────────────────────────────────────────── */

export default function Home() {
  return (
    <main className="relative overflow-hidden bg-[#FDFCFB] text-zinc-800">
      <BackgroundBlobs />
      <Navbar />
      <Hero />
      <StatsStrip />
      <HowItWorks />
      <PrivacyBand />
      <CtaBand />
      <Footer />
    </main>
  );
}

/* ─── background blobs ─────────────────────────────────────────────────── */

function BackgroundBlobs() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 -left-24 h-[500px] w-[500px] rounded-full bg-[#A8D5BA] opacity-25 blur-3xl" />
      <div className="absolute top-1/2 -right-32 h-[420px] w-[420px] rounded-full bg-[#9FBBE0] opacity-20 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-[360px] w-[360px] rounded-full bg-[#E8D5BA] opacity-20 blur-3xl" />
    </div>
  );
}

/* ─── nav auth button (hook-driven, no SignedIn/SignedOut wrappers) ────── */

function NavAuthButton() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return <div className="h-9 w-20 animate-pulse rounded-full bg-zinc-200/60" />;
  }

  if (user) {
    return (
      <UserButton
        appearance={{ elements: { avatarBox: 'h-9 w-9' } }}
        afterSignOutUrl="/"
      />
    );
  }

  return (
    <SignInButton mode="modal" forceRedirectUrl="/app">
      <button className="cursor-pointer rounded-full bg-zinc-900 px-6 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800/50 active:scale-95 min-w-[120px]">
        Sign in
      </button>
    </SignInButton>
  );
}

/* ─── navbar ───────────────────────────────────────────────────────────── */

function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/40 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-semibold tracking-tight text-zinc-900">
          Tremelo
        </Link>

        <div className="flex items-center gap-7">
          {/* desktop links — scroll to feature sections */}
          <div className="hidden items-center gap-7 text-[15px] text-zinc-500 md:flex">
            <a href="#features" className="transition-colors hover:text-zinc-900">Features</a>
            <a href="#how" className="transition-colors hover:text-zinc-900">How it works</a>
          </div>
          <NavAuthButton />
          {/* hamburger */}
          <button
            aria-label="Toggle menu"
            className="flex h-10 w-10 cursor-pointer flex-col items-center justify-center gap-[5px] rounded-lg transition-colors hover:bg-zinc-100 md:hidden"
            onClick={() => setOpen((o) => !o)}
          >
            <span className={`block h-0.5 w-5 bg-zinc-700 transition-transform duration-200 ${open ? 'translate-y-[7px] rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-zinc-700 transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-zinc-700 transition-transform duration-200 ${open ? '-translate-y-[7px] -rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      {/* mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-white/30 bg-white/90 backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col gap-1 px-5 py-4 text-sm text-zinc-700">
              <a href="#features" onClick={() => setOpen(false)} className="cursor-pointer rounded-lg px-3 py-3 text-base hover:bg-zinc-100">Features</a>
              <a href="#how" onClick={() => setOpen(false)} className="cursor-pointer rounded-lg px-3 py-3 text-base hover:bg-zinc-100">How it works</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

/* ─── smart Get Started button ─────────────────────────────────────────── */

function GetStartedButton() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  if (!isLoaded) {
    return <div className="h-16 w-52 animate-pulse rounded-full bg-zinc-200/60" />;
  }

  if (user) {
    return (
      <LiquidButton
        size="xl"
        onClick={() => router.push('/app')}
        aria-label="Get started — enter the app"
      >
        Get started →
      </LiquidButton>
    );
  }

  return (
    <SignInButton mode="modal" forceRedirectUrl="/app">
      <LiquidButton size="xl" aria-label="Sign in to get started">
        Get started →
      </LiquidButton>
    </SignInButton>
  );
}

/* ─── hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % HERO_KEYWORDS.length), 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 pb-20 pt-24 text-center">
      <HeroLeaves />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col items-center"
      >
        {/* headline — static line + separate cycling line to prevent reflow */}
        <h1
          className="text-[clamp(3.2rem,8vw,6.5rem)] leading-[1.05] tracking-tight text-zinc-800"
          style={{ fontFamily: SERIF }}
        >
          Your AI companion for
        </h1>

        {/* cycling keyword sits on its own line, fixed height = prevents reflow */}
        <div
          className="relative flex h-[1.1em] w-full items-center justify-center overflow-hidden text-[clamp(3.2rem,8vw,6.5rem)] leading-none"
          style={{ fontFamily: SERIF }}
          aria-live="polite"
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={HERO_KEYWORDS[index]}
              initial={{ y: 48, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -48, opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute italic text-zinc-400"
            >
              {HERO_KEYWORDS[index]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* subhead */}
        <p className="mt-8 max-w-xl text-[16px] leading-relaxed text-zinc-500 sm:text-[18px]">
          Built for people living with <strong className="font-medium text-zinc-700">Parkinson&rsquo;s disease</strong>.
          A gentle 20-second daily check-in gives you and your care team the insights that used to require a clinic visit — privately, on your own device.
        </p>

        {/* Single smart CTA */}
        <div className="mt-10">
          <GetStartedButton />
        </div>

        {/* scroll cue */}
        <motion.div
          animate={{ y: [0, 7, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
          className="mt-16 flex flex-col items-center gap-1.5 text-zinc-400"
        >
          <span className="text-[11px] uppercase tracking-[0.2em]">Scroll</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-50">
            <path d="M8 3v10M3 9l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      </motion.div>
    </section>
  );
}

/* ─── stats strip ───────────────────────────────────────────────────────── */

function StatsStrip() {
  const stats = [
    { big: '94%', label: 'Clinical accuracy', body: 'Our AI catches subtle changes you\'d never notice yourself — helping doctors act weeks earlier.' },
    { big: '20s', label: 'Daily check-in', body: 'No appointments. No waiting rooms. One calm moment in front of your laptop, once a day.' },
    { big: '100%', label: 'Private by design', body: 'Your camera footage never leaves your device. Only encrypted health numbers reach your care team.' },
    { big: '6 wks', label: 'Trend tracking', body: 'See how you\'re doing over weeks, not just today. Trends tell the story a single reading can\'t.' },
  ];

  return (
    <section id="features" className="scroll-mt-24 px-5 pb-24">
      <div className="mx-auto max-w-5xl">
        <FadeUp className="mb-4 text-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">By the numbers</span>
        </FadeUp>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s, i) => (
            <FadeUp key={s.label} delay={i * 0.08}>
              <div className="cursor-default rounded-2xl border border-white/70 bg-white/65 p-6 backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_8px_30px_rgba(0,0,0,0.07)] sm:p-7">
                <div
                  className="text-[2.6rem] leading-none text-zinc-900 sm:text-[3.2rem]"
                  style={{ fontFamily: SERIF }}
                >
                  {s.big}
                </div>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{s.label}</div>
                <p className="mt-2 text-[14px] leading-snug text-zinc-500">{s.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── how it works ──────────────────────────────────────────────────────── */

const STEPS = [
  {
    n: '01',
    title: 'Just open your browser',
    body: 'No downloads, no wearables, no appointment needed. Open the app on any laptop with a camera — your care team connects automatically.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" stroke="currentColor" className="h-6 w-6">
        <rect x="3" y="3" width="18" height="14" rx="2" /><path d="M7 21h10M12 17v4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    n: '02',
    title: 'Sit comfortably for 20 seconds',
    body: 'Face the camera and breathe. The app quietly captures the signals your doctor needs — you barely have to think about it.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" stroke="currentColor" className="h-6 w-6">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    n: '03',
    title: 'Your care team stays informed',
    body: 'Only encrypted health data leaves your device — never video. Your doctor sees trends and early alerts before they become problems.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" stroke="currentColor" className="h-6 w-6">
        <path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function HowItWorks() {
  return (
    <section id="how" className="px-5 pb-28">
      <div className="mx-auto max-w-5xl">
        <FadeUp className="mb-14 text-center">
          <span className="mb-3 block text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">How it works</span>
          <h2
            className="text-[clamp(2rem,4vw,3.4rem)] leading-tight text-zinc-800"
            style={{ fontFamily: SERIF }}
          >
            Simple enough for any day.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-zinc-500">
            Designed for people living with Parkinson&rsquo;s — and the families who care for them. No learning curve, no friction.
          </p>
        </FadeUp>

        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <FadeUp key={step.n} delay={i * 0.1}>
              <div className="flex h-full flex-col rounded-2xl border border-white/70 bg-white/65 p-7 backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_8px_30px_rgba(0,0,0,0.07)]">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
                    {step.icon}
                  </div>
                  <span
                    className="text-[12px] font-semibold tracking-[0.15em] text-zinc-300"
                    style={{ fontFamily: SERIF }}
                  >
                    {step.n}
                  </span>
                </div>
                <h3 className="mb-2.5 text-[17px] font-semibold leading-snug text-zinc-800">{step.title}</h3>
                <p className="text-[14px] leading-relaxed text-zinc-500">{step.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── privacy band ──────────────────────────────────────────────────────── */

function PrivacyBand() {
  const points = [
    { label: 'On-device inference', body: 'MediaPipe and the ML models run entirely in your browser — no cloud GPU required.' },
    { label: 'Encrypted transport', body: 'Only numerical biomarker scores leave the device, wrapped in TLS. Video bytes stay local.' },
    { label: 'No persistent storage', body: 'Raw video frames are discarded the moment extraction is done. Nothing is cached.' },
  ];

  return (
    <section id="privacy" className="px-5 pb-28">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/60 bg-white/50 backdrop-blur-xl">
        <div className="grid gap-0 lg:grid-cols-2">
          {/* left */}
          <FadeUp className="flex flex-col justify-center p-8 sm:p-12">
            <span className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">Privacy first</span>
          <h2
            className="text-[clamp(2rem,3.5vw,3rem)] leading-tight text-zinc-800"
            style={{ fontFamily: SERIF }}
          >
            Video never leaves<br className="hidden sm:block" /> your device.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-zinc-500">
              Clinical-grade accuracy without the tradeoffs. We extract the numbers, discard the pixels.
            </p>
            <Link
              href="/patient"
              className="mt-8 inline-flex w-fit cursor-pointer rounded-full bg-zinc-900 px-7 py-3 text-[13px] font-medium text-white transition-colors duration-200 hover:bg-zinc-700"
            >
              Try it now
            </Link>
          </FadeUp>

          {/* right — privacy points */}
          <FadeUp delay={0.1} className="flex flex-col justify-center gap-6 border-t border-white/50 p-8 sm:p-12 lg:border-l lg:border-t-0">
            {points.map((p) => (
              <div key={p.label} className="flex gap-4">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                    <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-zinc-800">{p.label}</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-zinc-500">{p.body}</p>
                </div>
              </div>
            ))}
          </FadeUp>
        </div>
      </div>
    </section>
  );
}

/* ─── CTA band ──────────────────────────────────────────────────────────── */

function CtaBand() {
  return (
    <FadeUp className="px-5 pb-28">
      <div className="mx-auto max-w-5xl rounded-3xl border border-white/60 bg-white/50 px-8 py-14 text-center backdrop-blur-xl sm:py-20">
        <h2
          className="mx-auto max-w-xl text-[clamp(2rem,4vw,3.4rem)] leading-tight text-zinc-800"
          style={{ fontFamily: SERIF }}
        >
          Take back control<br /> of your Parkinson&rsquo;s journey.
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-[15px] leading-relaxed text-zinc-500">
          Start your free Parkinson&rsquo;s check-in today. No hardware, no appointments — just open the app.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <GetStartedButton />
        </div>
      </div>
    </FadeUp>
  );
}

/* ─── footer ────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-zinc-200/50 bg-white/40 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-6 text-[13px] text-zinc-400 sm:flex-row">
        <span>© 2026 Tremelo</span>
        <div className="flex gap-5">
          <a href="#how" className="cursor-pointer transition-colors hover:text-zinc-600">How it works</a>
          <a href="#privacy" className="cursor-pointer transition-colors hover:text-zinc-600">Privacy</a>
        </div>
      </div>
    </footer>
  );
}
