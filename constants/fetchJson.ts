// constants/fetchJson.ts
export class ApiError<TBody = any> extends Error {
  name = "ApiError";
  status: number;
  body?: TBody;
  url?: string;

  constructor(message: string, opts: { status: number; body?: TBody; url?: string }) {
    super(message);
    this.status = opts.status;
    this.body = opts.body;
    this.url = opts.url;
  }
}

type FetchJsonOptions = RequestInit & {
  timeoutMs?: number;
};

function isProbablyJson(contentType: string | null) {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs, ...init } = options;

  const controller = new AbortController();
  const t = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers || {}),
        "User-Agent": "aml-monitor-app/1.0",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
      },
    });

    const contentType = res.headers.get("content-type");

    let body: any = null;
    try {
      if (isProbablyJson(contentType)) {
        body = await res.json();
      } else {
        const text = await res.text();
        // 서버가 JSON을 text로 내려주는 경우도 있어서 한 번 더 시도
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    } catch {
      body = null;
    }

    if (!res.ok) {
      throw new ApiError("Request failed", {
        status: res.status,
        body,
        url,
      });
    }

    return body as T;
  } finally {
    if (t) clearTimeout(t);
  }
}
