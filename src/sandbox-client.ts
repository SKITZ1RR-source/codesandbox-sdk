import { initPitcherClient } from "@codesandbox/pitcher-client";
import type { Client } from "@hey-api/client-fetch";

import type { VmStartResponse, tier } from "./client";
import {
  sandboxFork,
  vmHibernate,
  vmShutdown,
  vmStart,
  vmUpdateHibernationTimeout,
  vmUpdateSpecs,
} from "./client";
import { Sandbox } from "./sandbox";
import { handleResponse } from "./utils/handle-response";

export type SandboxPrivacy = "public" | "unlisted" | "private";
export type SandboxStartData = Required<VmStartResponse>["data"];

export const DEFAULT_SUBSCRIPTIONS = {
  client: {
    status: true,
  },
  file: {
    status: true,
    selection: true,
    ot: true,
  },
  fs: {
    operations: true,
  },
  git: {
    status: true,
    operations: true,
  },
  port: {
    status: true,
  },
  setup: {
    progress: true,
  },
  shell: {
    status: true,
  },
  system: {
    metrics: true,
  },
};

export type CreateSandboxOpts = {
  /**
   * What template to fork from, this is the id of another sandbox. Defaults to our
   * [universal template](https://codesandbox.io/s/github/codesandbox/sandbox-templates/tree/main/universal).
   */
  template?: string | Sandbox;

  /**
   * What the privacy of the new sandbox should be. Defaults to "public".
   */
  privacy?: SandboxPrivacy;

  /**
   * The title of the new sandbox.
   */
  title?: string;

  /**
   * The description of the new sandbox.
   */
  description?: string;

  /**
   * Whether to automatically connect to the sandbox after creation. If this is set to `false`,
   * the sandbox will not be connected to, and you will have to call {@link SandboxClient.start}
   * yourself or pass the returned start data to the browser.
   */
  autoConnect?: boolean;

  /**
   * Which tags to add to the sandbox, can be used for categorization and filtering. Max 10 tags.
   */
  tags?: string[];

  /**
   * In which folder to put the sandbox in (inside your workspace).
   */
  path?: string;
} & StartSandboxOpts;

/**
 * A VM tier is how we classify the specs of a VM. You can use this to request a VM with specific
 * specs.
 *
 * You can either get a tier by its name, or by specifying the minimum specs you need.
 *
 * ## Example
 *
 * ```ts
 * const tier = VMTier.Pico;
 * ```
 *
 * ```ts
 * const tier = VMTier.fromSpecs(16, 32, 40);
 * ```
 */
export class VMTier {
  /** 1 CPU, 2GiB RAM */
  public static readonly Pico = new VMTier("Pico", 1, 2, 20);
  /** 2 CPU, 4GiB RAM */
  public static readonly Nano = new VMTier("Nano", 2, 4, 20);
  /** 4 CPU, 8GiB RAM */
  public static readonly Micro = new VMTier("Micro", 4, 8, 20);
  /** 8 CPU, 16GiB RAM */
  public static readonly Small = new VMTier("Small", 8, 16, 30);
  /** 16 CPU, 32GiB RAM */
  public static readonly Medium = new VMTier("Medium", 16, 32, 40);
  /** 32 CPU, 64GiB RAM */
  public static readonly Large = new VMTier("Large", 32, 64, 50);
  /** 64 CPU, 128GiB RAM */
  public static readonly XLarge = new VMTier("XLarge", 64, 128, 50);

  private constructor(
    public readonly name: tier,
    public readonly cpuCores: number,
    public readonly memoryGiB: number,
    public readonly diskGB: number
  ) {}

  public static fromName(name: tier): VMTier {
    return VMTier[name];
  }

  /**
   * Returns the tier that complies to the given minimum specs.
   * @param cpuCores Amount of CPU cores needed
   * @param memoryGiB Amount of memory needed in GiB
   * @param diskGB Amount of disk space needed in GB
   */
  public static fromSpecs(specs: {
    cpu: number;
    memGiB: number;
    diskGB?: number;
  }): VMTier | undefined {
    return Object.values(VMTier).find(
      (tier) =>
        tier.cpuCores >= specs.cpu &&
        tier.memoryGiB >= specs.memGiB &&
        (specs.diskGB === undefined || tier.diskGB >= specs.diskGB)
    );
  }
}

function startOptionsFromOpts(opts: StartSandboxOpts | undefined) {
  if (!opts) return undefined;
  return {
    ipcountry: opts.ipcountry,
    tier: opts.vmTier?.name,
    hibernation_timeout_seconds: opts.hibernationTimeoutSeconds,
  };
}

export interface StartSandboxOpts {
  /**
   * Country, served as a hint on where you want the sandbox to be scheduled. For example, if "NL" is given
   * as a country, the sandbox will be scheduled in a cluster inside Europe. Note that this is not a guarantee,
   * and the sandbox might end up in a different region based on availability and scheduling decisions.
   *
   * Follows ISO 3166-1 alpha-2 codes.
   */
  ipcountry?: string;

  /**
   * Determines which specs to start the VM with. If not specified, the VM will start with the default specs for the workspace.
   * Check {@link VMTier} for available tiers.
   *
   * You can only specify a VM tier when starting a VM that is inside your workspace.
   * Specifying a VM tier for someone else's sandbox will return an error.
   */
  vmTier?: VMTier;

  /**
   * The amount of seconds to wait before hibernating the sandbox after inactivity.
   *
   * Defaults to 300 seconds for free users, 1800 seconds for pro users. Maximum is 86400 seconds (1 day).
   */
  hibernationTimeoutSeconds?: number;
}

export type HandledResponse<D, E> = {
  data?: {
    data?: D;
  };
  error?: E;
  response: Response;
};

export class SandboxClient {
  constructor(private readonly apiClient: Client) {}

  private get defaultTemplate(): string {
    if (this.apiClient.getConfig().baseUrl?.includes("codesandbox.stream")) {
      return "7ngcrf";
    }

    return "pcz35m";
  }

  /**
   * Open, start & connect to a sandbox that already exists
   */
  public async open(
    id: string,
    startOpts?: StartSandboxOpts
  ): Promise<Sandbox> {
    return this.connectToSandbox(id, () => this.start(id, startOpts));
  }

  /**
   * Try to start a sandbox that already exists, it will return the data of the started
   * VM, which you can pass to the browser. In the browser you can call `connectToSandbox` with this
   * data to control the VM without sharing your CodeSandbox API token in the browser.
   *
   * @param id the ID of the sandbox
   * @returns The start data, contains a single use token to connect to the VM
   */
  public async start(
    id: string,
    opts?: StartSandboxOpts
  ): Promise<SandboxStartData> {
    const startResult = await vmStart({
      client: this.apiClient,
      body: startOptionsFromOpts(opts),
      path: {
        id,
      },
    });

    const data = handleResponse(startResult, `Failed to start sandbox ${id}`);

    return data;
  }

  /**
   * Creates a sandbox by forking a template. You can pass in any template or sandbox id (from
   * any sandbox/template created on codesandbox.io, even your own templates) or don't pass
   * in anything and we'll use the default universal template.
   *
   * This function will also start & connect to the VM of the created sandbox, and return a {@link Sandbox}
   * that allows you to control the VM.
   *
   * @param opts Additional options for creating the sandbox
   *
   * @returns A promise that resolves to a {@link Sandbox}, which you can use to control the VM
   */
  async create(
    opts: { autoConnect: false } & CreateSandboxOpts
  ): Promise<SandboxStartData>;
  async create(
    opts?: { autoConnect?: true } & CreateSandboxOpts
  ): Promise<Sandbox>;
  async create(opts?: CreateSandboxOpts): Promise<Sandbox>;
  async create(opts?: CreateSandboxOpts): Promise<Sandbox | SandboxStartData> {
    const templateId = opts?.template || this.defaultTemplate;
    const privacy = opts?.privacy || "public";
    const tags = opts?.tags || ["sdk"];
    const path = opts?.path || "/SDK";

    // Always add the "sdk" tag to the sandbox, this is used to identify sandboxes created by the SDK.
    const tagsWithSdk = tags.includes("sdk") ? tags : [...tags, "sdk"];

    const result = await sandboxFork({
      client: this.apiClient,
      body: {
        privacy: privacyToNumber(privacy),
        title: opts?.title,
        description: opts?.description,
        tags: tagsWithSdk,
        path,
        start_options:
          opts?.autoConnect === false
            ? undefined
            : startOptionsFromOpts(opts || {}),
      },
      path: {
        id: typeof templateId === "string" ? templateId : templateId.id,
      },
    });

    const sandbox = handleResponse(result, "Failed to create sandbox");

    return this.connectToSandbox(sandbox.id, () => {
      if (sandbox.start_response) {
        return Promise.resolve(sandbox.start_response);
      }

      return this.start(sandbox.id, opts);
    });
  }

  /**
   * This is the same functionality as {@link SandboxClient.create}, but added to make forking more
   * discoverable.
   */
  async fork(
    id: string,
    opts: { autoConnect: false } & Omit<CreateSandboxOpts, "template">
  ): Promise<SandboxStartData>;
  async fork(
    id: string,
    opts?: { autoConnect?: true } & Omit<CreateSandboxOpts, "template">
  ): Promise<Sandbox>;
  async fork(
    id: string,
    opts?: Omit<CreateSandboxOpts, "template">
  ): Promise<Sandbox>;
  async fork(
    id: string,
    opts: Omit<CreateSandboxOpts, "template"> = {}
  ): Promise<Sandbox | SandboxStartData> {
    return this.create({ ...opts, template: id });
  }

  /**
   * Shuts down a sandbox. Files will be saved, and the sandbox will be stopped.
   *
   * @param id The ID of the sandbox to shutdown
   */
  async shutdown(id: string): Promise<void> {
    const response = await vmShutdown({
      client: this.apiClient,
      path: {
        id,
      },
    });

    handleResponse(response, `Failed to shutdown sandbox ${id}`);
  }

  /**
   * Hibernates a sandbox. Files will be saved, and the sandbox will be put to sleep. Next time
   * you start the sandbox it will be resumed from the last state it was in.
   *
   * @param id The ID of the sandbox to hibernate
   */
  async hibernate(id: string): Promise<void> {
    const response = await vmHibernate({
      client: this.apiClient,
      path: {
        id,
      },
    });

    handleResponse(response, `Failed to hibernate sandbox ${id}`);
  }

  /**
   * Updates the specs that this sandbox runs on. It will dynamically scale the sandbox to the
   * new specs without a reboot. Be careful when scaling specs down, if the VM is using more memory
   * than it can scale down to, it can become very slow.
   *
   * @param id The ID of the sandbox to update
   * @param tier The new VM tier
   */
  async updateTier(id: string, tier: VMTier): Promise<void> {
    const response = await vmUpdateSpecs({
      client: this.apiClient,
      path: { id },
      body: {
        tier: tier.name,
      },
    });

    handleResponse(response, `Failed to update sandbox tier ${id}`);
  }

  /**
   * Updates the hibernation timeout of a sandbox.
   *
   * @param id The ID of the sandbox to update
   * @param timeoutSeconds The new hibernation timeout in seconds
   */
  async updateHibernationTimeout(
    id: string,
    timeoutSeconds: number
  ): Promise<void> {
    const response = await vmUpdateHibernationTimeout({
      client: this.apiClient,
      path: { id },
      body: { hibernation_timeout_seconds: timeoutSeconds },
    });

    handleResponse(
      response,
      `Failed to update hibernation timeout for sandbox ${id}`
    );
  }

  private async connectToSandbox(
    id: string,
    startVm: () => Promise<
      Required<
        Required<
          Required<HandledResponse<VmStartResponse, unknown>>["data"]
        >["data"]
      >["data"]
    >
  ): Promise<Sandbox> {
    const pitcherClient = await initPitcherClient(
      {
        appId: "sdk",
        instanceId: id,
        onFocusChange() {
          return () => {};
        },
        requestPitcherInstance: async () => {
          const data = await startVm();
          const headers = this.apiClient.getConfig().headers as Headers;

          if (headers.get("x-pitcher-manager-url")) {
            // This is a hack, we need to tell the global scheduler that the VM is running
            // in a different cluster than the one it'd like to default to.

            const preferredManager = headers
              .get("x-pitcher-manager-url")
              ?.replace("/api/v1", "")
              .replace("https://", "");
            const baseUrl = this.apiClient
              .getConfig()
              .baseUrl?.replace("api", "global-scheduler");

            await fetch(
              `${baseUrl}/api/v1/cluster/${data.id}?preferredManager=${preferredManager}`
            ).then((res) => res.json());
          }

          return {
            bootupType: data.bootup_type as
              | "RUNNING"
              | "CLEAN"
              | "RESUME"
              | "FORK",
            pitcherURL: data.pitcher_url,
            workspacePath: data.workspace_path,
            userWorkspacePath: data.user_workspace_path,
            pitcherManagerVersion: data.pitcher_manager_version,
            pitcherVersion: data.pitcher_version,
            latestPitcherVersion: data.latest_pitcher_version,
            pitcherToken: data.pitcher_token,
            cluster: data.cluster,
          };
        },
        subscriptions: DEFAULT_SUBSCRIPTIONS,
      },
      () => {}
    );

    return new Sandbox(this, pitcherClient);
  }
}

function privacyToNumber(privacy: SandboxPrivacy): number {
  switch (privacy) {
    case "public":
      return 0;
    case "unlisted":
      return 1;
    case "private":
      return 2;
  }
}
