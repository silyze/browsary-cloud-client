# Browsary Cloud Client

Browser provider for Browsary Cloud instances, enabling remote browser management via a container service and coordination layer.

## Installation

```bash
npm install @silyze/browsary-cloud-client
```

## Usage

### BrowserClient

The `BrowserClient` class communicates with a Browsary Cloud server to manage browser containers.

```ts
import BrowserClient, {
  BrowserClientError,
} from "@silyze/browsary-cloud-client";

const client = new BrowserClient(new URL("https://your-cloud-endpoint:39029"));

// Fetch server metadata
try {
  const info = await client.serverInfo();
  console.log(info);
} catch (err) {
  if (err instanceof BrowserClientError)
    console.error("Client error:", err.message);
}

// List all active containers
const containers = await client.list();

// Create a new browser container
const created = await client.create({
  name: "test-browser",
  password: "secret",
  screen: { width: 1280, height: 720 },
  args: "--no-sandbox",
  coordinatorUrl: "https://coordinator.example.com/",
  image: "google-chrome",
});

// Build service URLs
const vncUrl = client.vncUrl(created);
const sshUrl = client.sshUrl(created);
const remoteUrl = client.remoteUrl(created);

// Control container lifecycle
await client.start(created.name);
await client.pause(created.name);
await client.unpause(created.name);
await client.stop(created.name);

// Stream logs
const logStream = await client.logs(created.name);
for await (const chunk of logStream) {
  process.stdout.write(chunk);
}

// Attach to container stdin
const attachStream = await client.attach(created.name, someReadableStream);
```

### RemoteBrowserProvider

`RemoteBrowserProvider` extends `BrowserProvider` to launch and manage Puppeteer `Browser` instances in Browsary Cloud.

```ts
import { RemoteBrowserProvider } from "@silyze/browsary-cloud-client";
import { Coordinator } from "@silyze/coordinator";

// Initialize your coordinator
const coordinator = new MyCoordinator("https://coordinator.example.com/");

// Create a provider with optional custom client and default container config
const provider = new RemoteBrowserProvider({
  coordinator,
  default: { name: "test-browser" },
});

// Acquire a Browser instance (launches or connects to the container)
const browser = await provider.getBrowser();

// Use puppeteer-core API
const page = await browser.newPage();
await page.goto("https://example.com");

// Release when done
await provider.releaseBrowser(browser);
```

## API Reference

### Types

#### `ServerOsInfo`

```ts
{ name: string; version?: string; kernel: { type: string; version: string } }
```

#### `ServerMemoryInfo`

```ts
{
  percentage: number;
  free: number;
  total: number;
}
```

#### `ServerCpuInfo` / `ServerCpu`

```ts
{ amount: number; load: [number, number, number]; cpus: ServerCpu[] }
```

#### `ServerInfo`

```ts
{
  name: string;
  id: string;
  os: ServerOsInfo;
  memory: ServerMemoryInfo;
  cpu: ServerCpuInfo;
}
```

#### `BrowserServiceContainer`

Ports for VNC, remote protocol, and SSH

#### `BrowserContainer`

Container metadata including `name`, `state`, `status`, and service ports

#### `BrowserContainerCreateDetails`

Parameters to create a new container:

- `password`: VNC/SSH password
- `screen`: height/width in pixels
- `name`: unique container name
- `args`: Docker or browser flags
- `coordinatorUrl`: URL for coordination
- `image`: container image tag

#### `BrowserClientError`

Thrown on non-JSON or error responses

#### `BrowserClient` Methods

- `serverInfo(): Promise<ServerInfo>`
- `list(): Promise<Array<BrowserContainer & { id: string }>>`
- `create(details): Promise<Omit<BrowserContainer, 'status'|'state'> & { id: string }>`
- `get(name): Promise<BrowserContainer>`
- `start/stop/pause/unpause(name): Promise<string>`
- `logs(name): Promise<ReadableStream>`
- `attach(name, input?): Promise<ReadableStream>`
- `vncUrl(container)`, `sshUrl(container)`, `remoteUrl(container)`: build service URLs

#### `RemoteBrowserProvider`

Extends `BrowserProvider<RemoteBrowserConfig>`:

- `getBrowser(config?): Promise<Browser>`
- `releaseBrowser(browser): void | Promise<void>`

##### `BaseRemoteBrowserConfig`

Extends `BaseBrowserConfig` with:

- `client?`: custom `BrowserClient`
- `coordinator`: `Coordinator` instance
- `default`: `RemoteBrowserConfig` for default container

##### `RemoteBrowserConfig`

Either `{ name: string }` to reuse a container or full create details without `coordinatorUrl`

## Error Handling

All client methods throw `BrowserClientError` when the server returns a non-200 status or invalid JSON payload.
