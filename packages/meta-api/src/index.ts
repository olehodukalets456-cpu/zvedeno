export type MetaClientOptions = {
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
  maxRetries?: number;
};

export type MetaPage<T> = {
  data: T[];
  paging?: {
    next?: string;
    cursors?: { before?: string; after?: string };
  };
};

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
};

function metaError(payload: unknown): MetaErrorBody["error"] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as MetaErrorBody).error;
}

function describePayload(payload: unknown): string | null {
  const error = metaError(payload);
  if (!error) return null;

  const parts = [
    error.message,
    error.type ? `type=${error.type}` : null,
    typeof error.code === "number" ? `code=${error.code}` : null,
    typeof error.error_subcode === "number" ? `subcode=${error.error_subcode}` : null,
    error.error_user_title,
    error.error_user_msg,
    error.fbtrace_id ? `trace=${error.fbtrace_id}` : null
  ].filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(" | ") : null;
}

function asksForLessData(payload: unknown): boolean {
  const error = metaError(payload);
  if (!error) return false;
  return (
    error.code === 1 &&
    /reduce the amount of data|too much data|request.*too large/i.test(error.message ?? "")
  );
}

function isRateLimit(payload: unknown): boolean {
  const error = metaError(payload);
  if (!error) return false;
  return (
    error.is_transient === true ||
    error.code === 4 ||
    error.code === 17 ||
    error.code === 32 ||
    error.code === 613 ||
    /request limit reached|too many api|rate limit/i.test(error.message ?? "")
  );
}

function reducePageSize(url: URL): number | null {
  const current = Number(url.searchParams.get("limit") ?? 0);
  const next = current > 100 ? 100 : current > 50 ? 50 : current > 25 ? 25 : current > 10 ? 10 : null;
  if (!next) return null;
  url.searchParams.set("limit", String(next));
  return next;
}

function capInitialPageSize(url: URL): void {
  const current = Number(url.searchParams.get("limit") ?? 0);
  if (current > 100) url.searchParams.set("limit", "100");
}

export class MetaApiError extends Error {
  constructor(
    label: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    const detail = describePayload(payload);
    super(detail ? `${label}: ${detail}` : `${label}: HTTP ${status}`);
    this.name = "MetaApiError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryableError(error: unknown): boolean {
  return (
    error instanceof MetaApiError &&
    (retryableStatus(error.status) || isRateLimit(error.payload))
  );
}

export class MetaClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(private readonly options: MetaClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://graph.facebook.com";
    this.maxRetries = options.maxRetries ?? 5;
  }

  private async requestUrl<T>(url: URL | string, label: string): Promise<T> {
    let lastError: unknown;
    const requestUrl = new URL(url.toString());
    capInitialPageSize(requestUrl);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(requestUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(60_000)
        });
        const text = await response.text();
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { raw: text };
        }

        if (response.ok) return payload as T;
        const error = new MetaApiError(label, response.status, payload);

        if (asksForLessData(payload) && attempt < this.maxRetries) {
          const nextLimit = reducePageSize(requestUrl);
          if (nextLimit) {
            console.warn("Meta response was too large; retrying with a smaller page", {
              label,
              limit: nextLimit
            });
            lastError = error;
            await sleep(150 + Math.floor(Math.random() * 150));
            continue;
          }
        }

        const retryable = retryableStatus(response.status) || isRateLimit(payload);
        if (!retryable || attempt === this.maxRetries) throw error;

        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        const exponential = isRateLimit(payload)
          ? Math.min(30_000, 5_000 * 2 ** attempt)
          : Math.min(30_000, 750 * 2 ** attempt);
        await sleep(Math.max(retryAfter * 1000, exponential) + Math.floor(Math.random() * 500));
        lastError = error;
      } catch (error) {
        lastError = error;
        if (error instanceof MetaApiError && !retryableError(error)) throw error;
        if (attempt === this.maxRetries) throw error;
        const delay = retryableError(error)
          ? Math.min(30_000, 5_000 * 2 ** attempt)
          : Math.min(30_000, 750 * 2 ** attempt);
        await sleep(delay + Math.floor(Math.random() * 500));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.options.apiVersion}/${path.replace(/^\//, "")}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("access_token", this.options.accessToken);
    return this.requestUrl<T>(url, "Meta API request failed");
  }

  async *paginate<T>(path: string, params: Record<string, string> = {}): AsyncGenerator<T> {
    let page = await this.get<MetaPage<T>>(path, params);

    while (true) {
      for (const item of page.data) yield item;
      const nextUrl = page.paging?.next;
      if (!nextUrl) return;
      page = await this.requestUrl<MetaPage<T>>(nextUrl, "Meta pagination failed");
    }
  }
}
