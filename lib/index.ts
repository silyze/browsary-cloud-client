import type { Browser } from "puppeteer-core";
import { BrowserProvider, BaseBrowserConfig } from "@silyze/browser-provider";
import { Coordinator } from "@silyze/coordinator";

export type ServerOsInfo = {
  name: string;
  version?: string;
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
  name: string;
  id: string;
  os: ServerOsInfo;
  memory: ServerMemoryInfo;
  cpu: ServerCpuInfo;
};

type BrowserServiceContainer = {
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

  get url() {
    return new URL(this.#baseUrl);
  }

  constructor(url: URL) {
    this.#baseUrl = url;
  }

  static default = new BrowserClient(
    new URL(process.env.BROWSER_SERVER_DEFAULT_URL ?? "http://localhost:39029")
  );

  serverInfo() {
    return handleJsonResponse<ServerInfo>(fetch(new URL("/", this.#baseUrl)));
  }

  list() {
    return handleJsonResponse<(BrowserContainer & { id: string })[]>(
      fetch(new URL("/containers", this.#baseUrl))
    );
  }

  create(details: BrowserContainerCreateDetails) {
    return handleJsonResponse<
      Omit<BrowserContainer, "status" | "state"> & { id: string }
    >(
      fetch(new URL("/containers", this.#baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(details),
      })
    );
  }

  vncUrl(container: BrowserServiceContainer) {
    const url = new URL(this.#baseUrl);
    url.port = container.services.vnc;
    url.protocol = url.protocol.replaceAll("http", "ws");
    return url;
  }

  sshUrl(container: BrowserServiceContainer) {
    const url = new URL(this.#baseUrl);
    url.port = container.services.ssh;
    url.protocol = "ssh:";
    url.username = "runner";
    return url;
  }

  remoteUrl(container: BrowserServiceContainer) {
    const url = new URL(this.#baseUrl);
    url.port = container.services.remote;
    return url;
  }

  get(name: string) {
    return handleJsonResponse<BrowserContainer>(
      fetch(new URL(`/containers/${encodeURIComponent(name)}`, this.#baseUrl))
    );
  }

  start(name: string) {
    return handleJsonResponse<string>(
      fetch(
        new URL(`/containers/${encodeURIComponent(name)}/start`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  stop(name: string) {
    return handleJsonResponse<string>(
      fetch(
        new URL(`/containers/${encodeURIComponent(name)}/stop`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  pause(name: string) {
    return handleJsonResponse<string>(
      fetch(
        new URL(`/containers/${encodeURIComponent(name)}/pause`, this.#baseUrl),
        {
          method: "POST",
        }
      )
    );
  }

  unpause(name: string) {
    return handleJsonResponse<string>(
      fetch(
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
      fetch(
        new URL(`/containers/${encodeURIComponent(name)}/logs`, this.#baseUrl)
      )
    );
  }

  attach(name: string, input?: ReadableStream) {
    return handleStreamResponse(
      fetch(
        new URL(
          `/containers/${encodeURIComponent(name)}/attach`,
          this.#baseUrl
        ),
        { method: "POST", body: input }
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
    const remoteUrl = client.remoteUrl(
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
