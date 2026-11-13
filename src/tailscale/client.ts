import type { ToolError } from "../core/result.ts";
import { CREDENTIAL_HINT, loadCredentials, type Credentials, type CredentialSource, type Env } from "./credentials.ts";

export const API_BASE = "https://api.tailscale.com/api/v2";
const REQUEST_TIMEOUT_MS = 20_000;
/** Refresh an OAuth access token this long before it expires. */
const TOKEN_SKEW_MS = 60_000;

export class TailscaleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly why: string | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = "TailscaleError";
  }

  toToolError(): ToolError {
    return { code: this.code, message: this.message, why: this.why, hint: this.hint };
  }
}

export interface AccessToken {
  token: string;
  source: CredentialSource;
  /** Scopes granted to the OAuth client. Null for an API key, which carries its owner's rights. */
  scopes: string[] | null;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  text: string;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: string;
  contentType?: string;
  accept?: string;
  /** Statuses returned to the caller instead of thrown. 2xx is always returned. */
  allow?: number[];
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  env?: Env;
  fetch?: FetchLike;
  credentials?: () => Promise<Credentials>;
  now?: () => number;
}

/** The API puts its reason in `message`; fall back to the raw body, capped, so an HTML error page stays short. */
export function apiMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) return parsed.message;
  } catch {
    // Not JSON: use the body itself.
  }
  return text.trim().slice(0, 300);
}

export class TailscaleClient {
  private readonly env: Env;
  private readonly fetchImpl: FetchLike;
  private readonly credentials: () => Promise<Credentials>;
  private readonly now: () => number;
  private cached: (AccessToken & { expiresAt: number }) | null = null;

  constructor(options: ClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.credentials = options.credentials ?? (() => loadCredentials({ env: this.env }));
    this.now = options.now ?? Date.now;
  }

  /** `-` means "the tailnet that owns the credential". */
  get tailnet(): string {
    return this.env.TAILSCALE_TAILNET?.trim() || "-";
  }

  tailnetPath(sub: string): string {
    return `/tailnet/${encodeURIComponent(this.tailnet)}/${sub}`;
  }

  async accessToken(): Promise<AccessToken> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached;

    const credentials = await this.credentials();
    if (credentials.source === "none") {
      throw new TailscaleError("not_configured", "No Tailscale credential is configured.", credentials.why, CREDENTIAL_HINT);
    }
    if (credentials.source === "api_key") {
      return { token: credentials.apiKey, source: "api_key", scopes: null };
    }

    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
    const response = await this.send(`${API_BASE}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new TailscaleError(
        "unauthorized",
        "Tailscale rejected the OAuth client.",
        `HTTP ${response.status}: ${apiMessage(text)}`,
        "Check the client ID and secret, and that the OAuth client still exists.",
      );
    }
    const grant = JSON.parse(text) as { access_token?: string; expires_in?: number; scope?: string };
    if (!grant.access_token) {
      throw new TailscaleError("upstream_error", "The OAuth token response had no access_token.");
    }
    this.cached = {
      token: grant.access_token,
      source: credentials.source,
      scopes: grant.scope ? grant.scope.split(/\s+/).filter(Boolean) : [],
      expiresAt: this.now() + (grant.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS,
    };
    return this.cached;
  }

  async request(path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    let access = await this.accessToken();
    let response = await this.authorized(path, options, access.token);

    // A cached OAuth token can be revoked before it expires: mint a new one once.
    if (response.status === 401 && this.cached) {
      this.cached = null;
      access = await this.accessToken();
      response = await this.authorized(path, options, access.token);
    }

    const text = await response.text();
    if (response.ok || options.allow?.includes(response.status)) {
      return { status: response.status, headers: response.headers, text };
    }
    throw this.failure(response.status, text, access);
  }

  private authorized(path: string, options: RequestOptions, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: options.accept ?? "application/json",
    };
    if (options.contentType) headers["Content-Type"] = options.contentType;
    return this.send(`${API_BASE}${path}`, { method: options.method ?? "GET", headers, body: options.body });
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new TailscaleError("timeout", `The Tailscale API did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
      }
      const why = error instanceof Error ? error.message : String(error);
      throw new TailscaleError("upstream_error", "Could not reach the Tailscale API.", why);
    }
  }

  private failure(status: number, text: string, access: AccessToken): TailscaleError {
    const why = `HTTP ${status}: ${apiMessage(text)}`;
    switch (status) {
      case 401:
        return new TailscaleError("unauthorized", "Tailscale rejected the credential.", why, "Check that the key or OAuth client is still valid.");
      case 403: {
        const granted = access.scopes ? `Granted scopes: ${access.scopes.join(", ") || "none"}.` : "The API key's owner lacks this permission.";
        return new TailscaleError("permission_denied", "The credential may not make this call.", why, `${granted} Add the scope that covers this call in the Tailscale admin console.`);
      }
      case 404:
        return new TailscaleError("not_found", "Tailscale found nothing at this path.", why);
      case 429:
        return new TailscaleError("rate_limited", "Tailscale rate-limited this call.", why, "Wait a moment and try again.");
      default:
        return new TailscaleError("upstream_error", "The Tailscale API returned an error.", why);
    }
  }
}
