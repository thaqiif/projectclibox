import { NextResponse } from "next/server";

/**
 * Small, copy-pasteable request guards for API routes.
 *
 * Each guard returns null when the request passes and a NextResponse to
 * return immediately when it fails, so a route can use it as:
 *
 *   const guard = guardJsonSameOrigin(request);
 *   if (guard) return guard;
 *
 * Only the request shape is checked here; route handlers stay in charge of
 * their own payloads and errors.
 */

/**
 * Reject requests whose Content-Type is not application/json.
 * Upload-style POSTs are always JSON, and browsers will not let a
 * cross-origin page POST application/json without CORS preflight, so this
 * doubles as a CSRF tripwire.
 *
 * A native Fetch Request with no body has `request.body === null`, so this
 * guard skips its content-type check in that case. Some Node framework
 * adapters wrap incoming HTTP messages as streams even when the wire request
 * had no body; bodyless routes should use `guardSameOrigin` directly instead
 * of relying on this check to identify them.
 */
export function guardJsonContent(request: Request): NextResponse | null {
  if (request.body == null) return null;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }
  return null;
}

/**
 * Reject requests whose Origin header does not match the request Host.
 *
 * If Origin is absent (same-origin fetches may omit it; curl and native
 * clients never send it) the request passes, so this hardens rather than
 * locks down.
 *
 * Behind reverse proxies that rewrite the Host header (various PaaS
 * proxies do), the browser's Origin no longer matches Host and every
 * POST would 403. When the proxy supplies X-Forwarded-Host, that value
 * is accepted as an alternative comparison target: it is only consulted
 * when the plain Host comparison fails, so direct deployments are
 * unaffected and a proxy without the header keeps the strict check.
 *
 * A raw HTTP client can spoof both Origin and X-Forwarded-Host and pass this
 * comparison. That is not a CSRF bypass: such a client does not receive a
 * browser's ambient credentials. A cross-origin browser script cannot send
 * X-Forwarded-Host without a successful CORS preflight because it is not a
 * CORS-safelisted header, and an HTML form cannot set it at all. The edge
 * proxy must still overwrite, rather than trust, inbound forwarding headers.
 * Proxies that strip BOTH Host and X-Forwarded-Host need their own
 * forwarding config; see README "Production migration checklist".
 */
export function guardSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (
    isAllowedOrigin(
      origin,
      request.headers.get("host"),
      request.headers.get("x-forwarded-host")
    )
  ) {
    return null;
  }

  return NextResponse.json(
    { error: "Origin does not match Host" },
    { status: 403 }
  );
}

/** Match a browser Origin against Host or the proxy's outer forwarded host. */
export function isAllowedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  forwardedHost: string | null | undefined
): boolean {
  if (!origin) return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return false;
  }

  const originHost = parsed.host.toLowerCase();
  const requestHost = host?.trim().toLowerCase();
  if (requestHost && originHost === requestHost) return true;

  // The first value is the outermost host set by the trusted edge proxy.
  const outerForwardedHost = forwardedHost
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return Boolean(outerForwardedHost && originHost === outerForwardedHost);
}

/** Require Origin for capability-issuing POST routes. */
export function guardRequiredSameOrigin(request: Request): NextResponse | null {
  if (!request.headers.get("origin")) {
    return NextResponse.json(
      { error: "Origin header is required" },
      { status: 403 }
    );
  }
  return guardSameOrigin(request);
}

export function guardJsonRequiredSameOrigin(
  request: Request
): NextResponse | null {
  return guardJsonContent(request) ?? guardRequiredSameOrigin(request);
}

/** Both guards: JSON content-type plus same-origin check. */
export function guardJsonSameOrigin(request: Request): NextResponse | null {
  return guardJsonContent(request) ?? guardSameOrigin(request);
}
