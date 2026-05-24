'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* ─── Standard Button (base-ui style kept for existing consumers) ─────── */

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-primary-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        xl: 'h-12 rounded-md px-10 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

/* ─── Liquid Glass Button ──────────────────────────────────────────────── */

const liquidbuttonVariants = cva(
  "inline-flex items-center transition-colors justify-center cursor-pointer gap-2 whitespace-nowrap rounded-full text-sm font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-zinc-800/50",
  {
    variants: {
      variant: {
        default: 'bg-transparent hover:scale-[1.03] duration-300 transition font-semibold text-zinc-900',
        dark: 'bg-transparent hover:scale-[1.03] duration-300 transition font-semibold text-white',
      },
      size: {
        default: 'h-11 px-6 py-2',
        sm: 'h-9 px-5 text-xs',
        lg: 'h-13 px-8 text-base',
        xl: 'h-15 px-10 text-[15px]',
        xxl: 'h-16 px-12 text-[16px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'xl' },
  },
);

function GlassFilter() {
  return (
    <svg className="hidden" aria-hidden>
      <defs>
        <filter id="liquid-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}

function LiquidButton({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof liquidbuttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <>
      <Comp
        data-slot="button"
        className={cn('relative isolate', liquidbuttonVariants({ variant, size, className }))}
        {...props}
      >
        {/* breathing green halo — sits just outside the button rim */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-1 -z-20 rounded-full"
          style={{ animation: 'liquid-glow-breathe 4.2s ease-in-out infinite' }}
        />

        {/* drifting soft green wash — gives the button a living, watery motion */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-full">
          <div
            aria-hidden
            className="absolute inset-[-30%]"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, rgba(168,213,186,0.55) 0%, rgba(168,213,186,0.18) 38%, transparent 65%)',
              animation: 'liquid-glow-drift 7s ease-in-out infinite',
              filter: 'blur(4px)',
            }}
          />
          {/* slow diagonal sheen — subtle, like light catching on water */}
          <div
            aria-hidden
            className="absolute top-0 h-full w-1/3"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
              animation: 'liquid-sheen-sweep 5.5s ease-in-out infinite',
              animationDelay: '1.2s',
              filter: 'blur(6px)',
            }}
          />
        </div>

        {/* liquid glass ring */}
        <div className="absolute inset-0 z-0 rounded-full shadow-[0_0_6px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3px_rgba(0,0,0,0.9),inset_-3px_-3px_0.5px_-3px_rgba(0,0,0,0.85),inset_1px_1px_1px_-0.5px_rgba(0,0,0,0.6),inset_-1px_-1px_1px_-0.5px_rgba(0,0,0,0.6),inset_0_0_6px_6px_rgba(0,0,0,0.12),inset_0_0_2px_2px_rgba(0,0,0,0.06),0_0_12px_rgba(255,255,255,0.15)] transition-all" />
        {/* backdrop distortion */}
        <div
          className="absolute inset-0 isolate -z-10 overflow-hidden rounded-full"
          style={{ backdropFilter: 'url("#liquid-glass")' }}
        />
        <div className="pointer-events-none relative z-10">{children}</div>
        <GlassFilter />
      </Comp>
    </>
  );
}

export { Button, buttonVariants, LiquidButton, liquidbuttonVariants };
