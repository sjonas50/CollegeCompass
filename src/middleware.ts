import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

// Define paths that should be public (no auth required)
const publicPaths = [
  '/',
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
];

// Define paths that require admin access
const adminPaths = ['/admin', '/api/admin'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the path is public
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // For API routes that aren't public, verify the token
  if (pathname.startsWith('/api/')) {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check for admin-only routes
    if (adminPaths.some(path => pathname.startsWith(path)) && user.role !== 'admin') {
      return NextResponse.json(
        { message: 'Admin access required' },
        { status: 403 }
      );
    }

    return NextResponse.next();
  }

  // For non-API routes that aren't public, redirect to login
  const user = getUserFromRequest(request);

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check for admin-only routes
  if (adminPaths.some(path => pathname.startsWith(path)) && user.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}; 