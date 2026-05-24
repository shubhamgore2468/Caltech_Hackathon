import { clerkMiddleware, createRouteMatcher, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
]);

const isProtectedApp = createRouteMatcher([
  '/app(.*)',
  '/patient(.*)',
  '/doctor(.*)',
]);

async function getRole(userId: string): Promise<string | undefined> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as { role?: string } | undefined)?.role;
  } catch {
    return undefined;
  }
}

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Bounce unauthenticated users away from protected routes
  if (isProtectedApp(req) && !userId) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl);
  }

  // /app is the generic entry point — fetch real publicMetadata and redirect by role
  if (req.nextUrl.pathname === '/app' && userId) {
    const role = await getRole(userId);
    const dest = role === 'doctor' ? '/doctor' : '/patient/checkin';
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // Prevent doctors from landing in the patient portal
  if (req.nextUrl.pathname.startsWith('/patient') && userId) {
    const role = await getRole(userId);
    if (role === 'doctor') {
      return NextResponse.redirect(new URL('/doctor', req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API and Clerk proxy routes
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
