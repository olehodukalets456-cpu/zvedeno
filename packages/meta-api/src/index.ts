export type MetaClientOptions = {
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
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

export class MetaClient {
  private readonly baseUrl: string;

  constructor(private readonly options: MetaClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://graph.facebook.com";
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.options.apiVersion}/${path.replace(/^\//, "")}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("access_token", this.options.accessToken);

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();

    if (!response.ok) {
      throw new MetaApiError("Meta API request failed", response.status, payload);
    }

    return payload as T;
  }

  async *paginate<T>(path: string, params: Record<string, string> = {}): AsyncGenerator<T> {
    let nextUrl: string | undefined;
    let page = await this.get<MetaPage<T>>(path, params);

    while (true) {
      for (const item of page.data) yield item;
      nextUrl = page.paging?.next;
      if (!nextUrl) return;

      const response = await fetch(nextUrl, { headers: { Accept: "application/json" } });
      const payload: unknown = await response.json();
      if (!response.ok) throw new MetaApiError("Meta pagination failed", response.status, payload);
      page = payload as MetaPage<T>;
    }
  }
}
