// Deliberately not `typeof fetch`: the global fetch type (in a Cloudflare Workers-typed environment) is
// overloaded to accept URL/RequestInfo/CfProperties, which a plain vi.fn() mock typed against a simple
// (url: string, init?) shape can't satisfy under strict function-type checking. load-test-worker.mjs only
// ever calls fetchImpl with a string URL and a plain {signal, headers} init, so this narrower shape is both
// what's actually used and what test mocks can trivially implement.
export type LoadTestFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<Response>;

export type RequestOnceOptions = {
  fetchImpl?: LoadTestFetch;
  timeoutMs?: number;
};

export type RequestOnceResult = {
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  error?: string;
};

export type LoadTestOptions = {
  origin?: string;
  path?: string;
  levels?: number[];
  requestCount?: number;
  fetchImpl?: LoadTestFetch;
  timeoutMs?: number;
};

export type LoadTestLevelResult = {
  concurrency: number;
  requestCount: number;
  path: string;
  wallMs: number;
  successCount: number;
  errorCount: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
};

export declare const DEFAULT_ORIGIN: string;
export declare const DEFAULT_PATH: string;
export declare const DEFAULT_CONCURRENCY_LEVELS: number[];
export declare const DEFAULT_REQUESTS_PER_LEVEL: number;
export declare const DEFAULT_TIMEOUT_MS: number;

export declare function requestOnce(url: string, options?: RequestOnceOptions): Promise<RequestOnceResult>;

export declare function percentile(values: readonly number[], p: number): number;

export declare function runConcurrencyLevel(
  concurrency: number,
  options?: LoadTestOptions,
): Promise<LoadTestLevelResult>;

export declare function runLoadTest(options?: LoadTestOptions): Promise<LoadTestLevelResult[]>;

export declare function formatLoadTestReport(results: readonly LoadTestLevelResult[]): string;
