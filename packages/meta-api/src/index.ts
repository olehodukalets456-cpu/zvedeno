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

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
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
        if (!retryableStatus(response.status) || attempt === this.maxRetries) throw error;

        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        const exponential = Math.min(30_000, 750 * 2 ** attempt);
        await sleep(Math.max(retryAfter * 1000, exponential) + Math.floor(Math.random() * 500));
        lastError = error;
      } catch (error) {
        lastError = error;
        if (error instanceof MetaApiError && !retryableStatus(error.status)) throw error;
        if (attempt === this.maxRetries) throw error;
        await sleep(Math.min(30_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 500));
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
