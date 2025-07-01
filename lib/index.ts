import type { Browser } from "puppeteer-core";
import { BrowserProvider, BaseBrowserConfig } from "@silyze/browser-provider";
import { Coordinator } from "@silyze/coordinator";
import { assertNonNull } from "@mojsoski/assert";

export type ScoreBreakdownResponse = Record<string, ScoreBreakdown>;

export interface ScoreBreakdown {
  weights: WeightEntry[];
  score: number;
  health: number;
  status: "healthy" | "unhealthy" | string;
}

export interface WeightEntry {
  name: string;
  multiplier: number;
  baseValue: number;
  weightedValue: number;
}

export type ProxyInfo = {
  suffix: string;
  apiUrl: string;
  servers: string[];
};

export type ServerOsInfo = {
  version: string;
  kernel: {
    type: string;
    version: string;
  };
};

export type ServerMemoryInfo = {
  percentage: number;
  free: number;
  total: number;
};

export type ServerCpu = {
  model: string;
  speed: number;
  times: {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
  };
};

export type ServerCpuInfo = {
  amount: number;
  load: [number, number, number];
  cpus: ServerCpu[];
};

export type ServerInfo = {
  id: string;
  secure: boolean;
  ip?: string;
  proxy?: ProxyInfo;
  name: string;
  os: ServerOsInfo;
  memory: ServerMemoryInfo;
  cpu: ServerCpuInfo;
};

type BrowserServiceContainer = {
  password: string;
  services: {
    vnc: string;
    remote: string;
    ssh: string;
  };
};

export type BrowserContainer = {
  name: string;
  state: string;
  status: string;
} & BrowserServiceContainer;

export type BrowserContainerCreateDetails = {
  password: string;
  screen: {
    height: number;
    width: number;
  };
  name: string;
  args: string;
  coordinatorUrl: string;
  image: string;
};

export class BrowserClientError extends Error {}

async function handleError(response: Response): Promise<never> {
  if (!response.headers.get("content-type")?.startsWith("application/json")) {
    throw new BrowserClientError(await response.text());
  }
  const { error } = await response.json();
  throw new BrowserClientError(error);
}

async function handleJsonResponse<T>(
  baseResponse: Promise<Response> | Response
) {
  const response = await baseResponse;
  if (response.ok) {
    return (await response.json()) as T;
  }

  return await handleError(response);
}

async function handleStreamResponse(
  baseResponse: Promise<Response> | Response
) {
  const response = await baseResponse;
  if (response.ok) {
    return response.body;
  }

  return await handleError(response);
}

export default class BrowserClient {
  #baseUrl: URL;
  #token: string | undefined;

  get url() {
    return new URL(this.#baseUrl);
  }

  constructor(url: URL, token?: string) {
    this.#baseUrl = url;
    this.#token = token;
  }

  static default = new BrowserClient(
    new URL(process.env.BROWSER_SERVER_DEFAULT_URL ?? "http://localhost:39029"),
    process.env.BROWSER_SERVER_DEFAULT_TOKEN
  );

  #makeHeaders(): HeadersInit {
    const headers: HeadersInit = { "content-type": "application/json" };
    if (this.#token) {
      headers["Authorization"] = `Bearer ${this.#token}`;
    }
    return headers;
  }

  #fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const headers = this.#makeHeaders();
    return fetch(input, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers ?? {}),
      },
    });
  }

  serverInfo() {
    return handleJsonResponse<ServerInfo>(
      this.#fetch(new URL("/", this.#baseUrl))
    );
  }

  async serverScores(): Promise<ScoreBreakdownResponse> {
    const info = await this.serverInfo();

    if (!info.proxy) {
      throw new Error("This server does not support proxy scores.");
    }

    return handleJsonResponse<ScoreBreakdownResponse>(
      this.#fetch(new URL("/scores", this.#baseUrl))
    );
  }

  list() {
    return handleJsonResponse<(BrowserContainer & { id: string })[]>(
      this.#fetch(new URL("/containers", this.#baseUrl))
    );
  }

  create(details: BrowserContainerCreateDetails) {
    return handleJsonResponse<
      Omit<BrowserContainer, "status" | "state"> & { id: string }
    >(
      this.#fetch(new URL("/containers", this.#baseUrl), {
        method: "POST",
        body: JSON.stringify(details),
      })
    );
  }
  async vncUrl(
    container: BrowserServiceContainer & { name: string }
  ): Promise<URL> {
    const info = await this.serverInfo();

    if (info.proxy) {
      const scheme = info.secure ? "wss" : "ws";
      const host = `vnc-${container.name}${info.proxy.suffix}`;
      return new URL(`${scheme}://${host}`);
    } else {
      const url = new URL(this.#baseUrl);
      assertNonNull(info.ip, "info.ip");
      url.hostname = info.ip;
      url.port = container.services.vnc;
      url.protocol = info.secure ? "wss:" : "ws:";
      return url;
    }
  }

  async remoteUrl(
    container: BrowserServiceContainer & { name: string }
  ): Promise<URL> {
    const info = await this.serverInfo();

    if (info.proxy) {
      const scheme = info.secure ? "https" : "http";
      const host = `remote-${container.password}-${container.name}${info.proxy.suffix}`;
      return new URL(`${scheme}://${host}`);
    } else {
      const url = new URL(this.#baseUrl);
      assertNonNull(info.ip, "info.ip");
      url.hostname = info.ip;
      url.port = container.services.remote;
      url.protocol = info.secure ? "https:" : "http:";
      return url;
    }
  }

  async sshUrl(
    container: BrowserServiceContainer & { name: string }
  ): Promise<URL> {
    const info = await this.serverInfo();

    if (info.proxy) {
      throw new Error("SSH access is not available via proxy");
    }

    const url = new URL(this.#baseUrl);
    assertNonNull(info.ip, "info.ip");
    url.hostname = info.ip;
    url.port = container.services.ssh;
    url.protocol = "ssh:";
    url.username = "runner";
    return url;
  }

  get(name: string) {
    return handleJsonResponse<BrowserContainer>(
      this.#fetch(
        new URL(`/containers/${encodeURIComponent(name)}`, this.#baseUrl)
      )
    );
  }

  start(name: string) {
    return handleJsonResponse<string>(
      this.#fetch(
        new URL(`/containers/${encodeURIComponent(name)}/start`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  stop(name: string) {
    return handleJsonResponse<string>(
      this.#fetch(
        new URL(`/containers/${encodeURIComponent(name)}/stop`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  pause(name: string) {
    return handleJsonResponse<string>(
      this.#fetch(
        new URL(`/containers/${encodeURIComponent(name)}/pause`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  unpause(name: string) {
    return handleJsonResponse<string>(
      this.#fetch(
        new URL(
          `/containers/${encodeURIComponent(name)}/unpause`,
          this.#baseUrl
        ),
        {
          method: "POST",
        }
      )
    );
  }

  logs(name: string) {
    return handleStreamResponse(
      this.#fetch(
        new URL(`/containers/${encodeURIComponent(name)}/logs`, this.#baseUrl)
      )
    );
  }

  attach(name: string, input?: ReadableStream) {
    return handleStreamResponse(
      this.#fetch(
        new URL(
          `/containers/${encodeURIComponent(name)}/attach`,
          this.#baseUrl
        ),
        {
          method: "POST",
          body: input,
        }
      )
    );
  }
}

export type BaseRemoteBrowserConfig = BaseBrowserConfig & {
  client?: BrowserClient;
  coordinator: Coordinator;
  default: RemoteBrowserConfig;
};

type RemoteBrowserConfig =
  | { name: string }
  | Omit<BrowserContainerCreateDetails, "coordinatorUrl">;

export class RemoteBrowserProvider extends BrowserProvider<RemoteBrowserConfig> {
  #client: BrowserClient | undefined;
  #coordinator: Coordinator;
  #default: RemoteBrowserConfig;
  #clients: WeakMap<Browser, "close" | "disconnect"> = new WeakMap();

  constructor(config: BaseRemoteBrowserConfig) {
    super(config);
    this.#client = config.client;
    this.#default = config.default;
    this.#coordinator = config.coordinator;
  }
  public async getBrowser(config?: RemoteBrowserConfig): Promise<Browser> {
    const client = this.#client ?? BrowserClient.default;
    config ??= this.#default;
    const shouldClose = "args" in config;
    const remoteUrl = await client.remoteUrl(
      "args" in config
        ? await client.create({
            ...config,
            coordinatorUrl: this.#coordinator.url,
          })
        : await client.get(config.name)
    );

    await this.#coordinator.waitForServiceStatus(
      config.name,
      "remote",
      "running"
    );

    const browser = await this.fromFactory(remoteUrl);
    this.#clients.set(browser, shouldClose ? "close" : "disconnect");
    return browser;
  }

  public releaseBrowser(browser: Browser): Promise<void> | void {
    if (!browser.connected) return;
    const requiredAction = this.#clients.get(browser);
    if (requiredAction === "close") {
      return browser.close();
    }
    return browser.disconnect();
  }
}
