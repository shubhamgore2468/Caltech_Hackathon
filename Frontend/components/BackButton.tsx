'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface BackButtonProps {
  /** Explicit route; falls back to browser history when omitted */
  href?: string;
  label?: string;
  className?: string;
}

export function BackButton({ href, label = 'Back', className = '' }: BackButtonProps) {
  const router = useRouter();
  const styles =
    'inline-flex items-center gap-1 text-sm font-medium text-blue-800 hover:text-blue-900';

  if (href) {
    return (
      <Link href={href} className={`${styles} ${className}`}>
        ← {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={`${styles} ${className}`}>
      ← {label}
    </button>
  );
}
