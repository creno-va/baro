import { Container } from "@cloudflare/containers";
import {
  createProcessorCapacity,
  type ProcessorCapacityHolder,
  sameCapacityHolder,
  waitForProcessorCapacity,
} from "../server/modules/file-processing/container-capacity";
import { processorStage } from "../server/modules/file-processing/container-diagnostics";
import { createProcessorLifecycle } from "../server/modules/file-processing/container-lifecycle";

const coordinatorName = "baro-native-capacity-v1";
const capacityKey = "baro-native-capacity-holder-v1";
const tokenKey = "baro-native-capacity-token-v1";

/** One named attempt, with a clean native instance per bounded step. */
export class FileProcessorContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override enableInternet = false;
  override envVars = {};
  private lifecycle = createProcessorLifecycle({
    isRevoked: async () => (await this.ctx.storage.get("baro-native-revoked-v1")) === true,
    persistRevoked: () => this.ctx.storage.put("baro-native-revoked-v1", true),
    // Reset plaintext without releasing a slot prepared before the caller's
    // final authorization. Terminal cleanup below releases that exact token.
    reset: () => this.destroy(),
    destroy: async () => {
      // Release only after physical destruction is acknowledged, including
      // cleanup after a failed or ambiguously acknowledged start.
      await this.destroy();
      const token = await this.ctx.storage.get<string>(tokenKey);
      if (token) {
        await this.coordinator().releaseCapacity(this.ctx.id.toString(), token);
        await this.ctx.storage.delete(tokenKey);
      }
    },
    start: async (signal) => {
      const token = (await this.ctx.storage.get<string>(tokenKey)) ?? crypto.randomUUID();
      await this.ctx.storage.put(tokenKey, token);
      await processorStage("capacity_wait", () =>
        waitForProcessorCapacity(
          () => this.coordinator().claimCapacity(this.ctx.id.toString(), token),
          signal,
        ),
      );
      await this.startAndWaitForPorts({
        ports: [8080],
        cancellationOptions: {
          abort: signal,
          instanceGetTimeoutMS: 15_000,
          portReadyTimeoutMS: 20_000,
        },
        startOptions: { enableInternet: false, envVars: {} },
      });
    },
    fetch: async (incoming) => {
      const container = this.ctx.container;
      if (!container) throw new Error("PROCESSOR_UNAVAILABLE");
      // SDK convenience proxy logs exceptions; use the platform port directly.
      return container.getTcpPort(8080).fetch(incoming);
    },
  });

  private coordinator() {
    return this.env.FILE_PROCESSOR.get(this.env.FILE_PROCESSOR.idFromName(coordinatorName));
  }

  private capacity() {
    if (!this.ctx.id.equals(this.env.FILE_PROCESSOR.idFromName(coordinatorName)))
      throw new Error("INVALID_CAPACITY_COORDINATOR");
    return createProcessorCapacity({
      read: async () => (await this.ctx.storage.get<ProcessorCapacityHolder>(capacityKey)) ?? null,
      replace: (expected, next) =>
        this.ctx.storage.transaction(async (storage) => {
          const current = (await storage.get<ProcessorCapacityHolder>(capacityKey)) ?? null;
          if (!sameCapacityHolder(current, expected)) return false;
          if (next) await storage.put(capacityKey, next);
          else await storage.delete(capacityKey);
          return true;
        }),
      stop: (instance, token) =>
        this.env.FILE_PROCESSOR.get(
          this.env.FILE_PROCESSOR.idFromString(instance),
        ).stopCapacityHolder(token),
      now: Date.now,
    });
  }

  /** Internal RPC only. The coordinator never starts a native instance itself. */
  async prepareCapacity(token: string): Promise<boolean> {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("INVALID_CAPACITY_HOLDER");
    this.renewActivityTimeout();
    const prepared = await this.ctx.storage.transaction(async (storage) => {
      if (await storage.get("baro-native-revoked-v1")) throw new Error("REVOKED");
      const previous = await storage.get<string>(tokenKey);
      if (previous && previous !== token) return false;
      await storage.put(tokenKey, token);
      return true;
    });
    return prepared && this.coordinator().claimCapacity(this.ctx.id.toString(), token);
  }

  async claimCapacity(instance: string, token: string): Promise<boolean> {
    this.validateCapacityIdentity(instance, token);
    return this.capacity().claim(instance, token);
  }

  async releaseCapacity(instance: string, token: string): Promise<void> {
    this.validateCapacityIdentity(instance, token);
    await this.capacity().release(instance, token);
  }

  async stopCapacityHolder(token: string): Promise<void> {
    // A delayed coordinator recovery may arrive after a newer unit has already
    // acquired a different token on this same named attempt. Leave it running.
    if ((await this.ctx.storage.get<string>(tokenKey)) === token) await this.lifecycle.stop();
  }

  private validateCapacityIdentity(instance: string, token: string) {
    if (
      !/^[a-f0-9]{64}$/.test(instance) ||
      !/^[a-f0-9-]{36}$/.test(token) ||
      instance === this.ctx.id.toString()
    )
      throw new Error("INVALID_CAPACITY_HOLDER");
  }

  override onError(): void {}

  override async onActivityExpired(): Promise<void> {
    await this.stopProcessing();
  }

  async stopProcessing(): Promise<void> {
    await this.lifecycle.stop();
  }

  /** Internal RPC: persists revocation before acknowledging physical cleanup. */
  async revoke(): Promise<void> {
    await this.lifecycle.revoke();
  }

  override fetch(request: Request): Promise<Response> {
    return this.lifecycle.fetch(request);
  }
}
