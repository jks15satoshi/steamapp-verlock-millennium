import { jest } from "bun:test";

export interface BridgeCall {
  method: string;
  payload: unknown;
}

export const bridge = {
  calls: [] as BridgeCall[],
  reset(): void {
    this.calls.length = 0;
  },
  record(method: string, payload: unknown): void {
    this.calls.push({ method, payload });
  },
  find(method: string): BridgeCall[] {
    return this.calls.filter((call) => call.method === method);
  },
};

export const Millennium = {
  callServerMethod: async (
    _pluginName: string,
    methodName: string,
    payload?: unknown,
  ): Promise<{ ok: boolean }> => {
    bridge.record(methodName, payload);
    return { ok: true };
  },
  exposeObj: (object: unknown): unknown => object,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const backendResponses = new Map<string, unknown>();

export function setBackendResponse(method: string, response: unknown): void {
  backendResponses.set(method, response);
}

export function resetBackendResponses(): void {
  backendResponses.clear();
}

export const backend = new Proxy(
  {},
  {
    get: (
      _target: object,
      property: string | symbol,
    ): ((payload?: unknown) => Promise<unknown>) => {
      return (payload?: unknown) => {
        const method = String(property);
        bridge.record(method, payload);
        if (backendResponses.has(method)) {
          const response = backendResponses.get(method);
          const value =
            typeof response === "function"
              ? (response as (payload: unknown) => unknown)(payload)
              : response;
          return Promise.resolve(value);
        }
        if (method === "list_locked") {
          return Promise.resolve([] as unknown[]);
        }
        if (method === "get_required_apps") {
          return Promise.resolve({ ok: true, apps: [] as string[] });
        }
        return Promise.resolve({ ok: true });
      };
    },
  },
);

export interface SteamClientFake {
  Console: unknown;
  Apps: unknown;
  System: unknown;
}

export function installSteamClient(steamClient: SteamClientFake): void {
  const globals = globalThis as Record<string, unknown>;
  globals.SteamClient = steamClient;
  globals.Millennium = Millennium;
  globals.backend = backend;
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

export async function settle<T>(promise: Promise<T>, totalMs: number, stepMs: number): Promise<T> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let elapsed = 0; elapsed <= totalMs && !settled; elapsed += stepMs) {
    jest.advanceTimersByTime(stepMs);
    jest.setSystemTime(Date.now() + stepMs);
    await flush();
  }
  return promise;
}

export async function pump(totalMs: number, stepMs: number): Promise<void> {
  for (let elapsed = 0; elapsed <= totalMs; elapsed += stepMs) {
    jest.advanceTimersByTime(stepMs);
    jest.setSystemTime(Date.now() + stepMs);
    await flush();
  }
}

function appidFrom(payload: unknown): string {
  if (typeof payload === "string") {
    try {
      return appidFrom(JSON.parse(payload));
    } catch {
      return payload;
    }
  }
  if (payload !== null && typeof payload === "object" && "appid" in payload) {
    return String((payload as { appid: unknown }).appid);
  }
  return String(payload);
}

export function appIdsFor(method: string): string[] {
  return bridge.find(method).map((call) => appidFrom(call.payload));
}
