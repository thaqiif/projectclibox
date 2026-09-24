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
 * Bodyless requests — a bare `fetch(url, { method: "DELETE" })` sends
 * neither a body nor a Content-Type — have no payload for this guard to
 * classify. Per Fetch Standard §5.3, "The body getter steps are to return
 * null if this's body is null; otherwise this's body's stream." Request
 * construction only extracts `RequestInit.body` when it exists and is
 * non-null (§5.4). Thus `request.body === null` means there is no payload;
 * a payload sent without Content-Length still produces a body stream. The
 * separate same-origin guard remains responsible for bodyless CSRF attempts.
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

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return NextResponse.json(
      { error: "Invalid Origin header" },
      { status: 403 }
    );
  }

  const host = request.headers.get("host")?.toLowerCase();
  if (host && originHost.toLowerCase() === host) return null;

  // Proxy fallback: compare against the host the proxy says it forwarded
  // for (first value wins; X-Forwarded-Host: a, b means the outermost hop).
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedHost && originHost.toLowerCase() === forwardedHost) return null;

  return NextResponse.json(
    { error: "Origin does not match Host" },
    { status: 403 }
  );
}

/** Both guards: JSON content-type plus same-origin check. */
export function guardJsonSameOrigin(request: Request): NextResponse | null {
  return guardJsonContent(request) ?? guardSameOrigin(request);
}
