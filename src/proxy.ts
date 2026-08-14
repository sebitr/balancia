import { NextResponse, type NextRequest } from "next/server";
import { isWebAssemblyInferenceEnabled } from "@/lib/env";
import { APPLE_CALLBACK_PATH } from "@/modules/auth/apple-paths";

/**
 * Security headers and origin validation.
 *
 * This is Next.js 16's `proxy` convention (the former `middleware`). It runs on
 * the Node.js runtime for every request and does two things:
 *
 *  1. Sets a strict Content-Security-Policy with a per-request nonce, plus the
 *     usual hardening headers.
 *  2. Rejects cross-origin state-changing requests whose Origin header does not
 *     match the host — a defence-in-depth CSRF check on top of the framework's
 *     own Server Action origin validation and SameSite cookies.
 *
 * A correlation ID is attached so a request can be followed through the logs.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The one endpoint a cross-origin POST is supposed to reach.
 *
 * Sign in with Apple returns its result as a form POST from
 * appleid.apple.com, so the origin check below would reject every completed
 * sign-in. What stands in for it there is the `state` parameter: the callback
 * compares it against an HMAC-signed, browser-bound cookie before it does
 * anything, which is the defence this check approximates for everything else.
 *
 * Kept to an exact path — not a prefix — so it exempts that handler and no
 * route that might later be added beside it.
 */
const CROSS_ORIGIN_POST_ALLOWED = new Set([APPLE_CALLBACK_PATH]);

function buildCsp(nonce: string, isDevelopment: boolean): string {
  // Compiling WebAssembly needs its own token. Added only where the operator
  // asked for a local-inference feature — the embedding model, receipt
  // scanning, or both — so the default policy stays strict. It permits WASM
  // compilation and nothing else; it is not `unsafe-eval`.
  const localInference = isWebAssemblyInferenceEnabled();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets Next's own bootstrap load its chunks; the nonce is
    // what actually authorizes the first script.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(localInference ? ["'wasm-unsafe-eval'"] : []),
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    // Next injects inline <style> for its CSS; a nonce cannot cover all of it.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // No third-party endpoints: Balancia talks only to its own origin.
    "connect-src": ["'self'", ...(isDevelopment ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([directive, values]) => `${directive} ${values.join(" ")}`,
  );
  if (!isDevelopment) {
    parts.push("upgrade-insecure-requests");
  }
  return parts.join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV === "development";

  // Origin check for state-changing requests. Server Actions are additionally
  // protected by Next.js itself; this covers route handlers too.
  if (
    !SAFE_METHODS.has(request.method) &&
    !CROSS_ORIGIN_POST_ALLOWED.has(request.nextUrl.pathname)
  ) {
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || (host && originHost !== host)) {
        return new NextResponse("Cross-origin request rejected", {
          status: 403,
        });
      }
    }
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const requestId = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(
    "Content-Security-Policy",
    buildCsp(nonce, isDevelopment),
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    // camera=(self): the receipt scanner's live document camera. Frames are
    // processed on the device and never uploaded; see src/lib/doc-scan.
    "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  );
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");

  if (!isDevelopment) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker, which must be
    // served without a nonce-bearing CSP to stay cacheable.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
  ],
};
