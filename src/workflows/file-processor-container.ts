import { DurableObject } from "cloudflare:workers";
import {
  createProcessorCapacity,
  type ProcessorCapacityHolder,
  sameCapacityHolder,
  waitForProcessorCapacity,
} from "../server/modules/file-processing/container-capacity";
import { processorStage } from "../server/modules/file-processing/container-diagnostics";
import { createProcessorLifecycle } from "../server/modules/file-processing/container-lifecycle";
import { startNativeProcessor } from "../server/modules/file-processing/native-startup";

const coordinatorName = "baro-native-capacity-v1";
const capacityKey = "baro-native-capacity-holder-v1";
const tokenKey = "baro-native-capacity-token-v1";
const cleanupKey = "baro-native-cleanup-at-v1";

/** One named attempt, with a clean native instance per bounded step. */
export class FileProcessorContainer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running)
      void ctx.blockConcurrencyWhile(async () => {
        // Preserve a recorded deadline. An older SDK process without one is an
        // orphan to stop, rather than an excuse to extend its native lifetime.
        await ctx.storage.setAlarm((await ctx.storage.get<number>(cleanupKey)) ?? Date.now());
      });
  }

  private native() {
    const container = this.ctx.container;
    if (!container) throw new Error("PROCESSOR_UNAVAILABLE");
    return container;
  }

  private async armCleanup() {
    const until = Date.now() + 300_000;
    await this.ctx.storage.put(cleanupKey, until);
    await this.ctx.storage.setAlarm(until);
  }
  private lifecycle = createProcessorLifecycle({
    isRevoked: async () => (await this.ctx.storage.get("baro-native-revoked-v1")) === true,
    persistRevoked: () => this.ctx.storage.put("baro-native-revoked-v1", true),
    // Reset plaintext without releasing a slot prepared before the caller's
    // final authorization. Terminal cleanup below releases that exact token.
    reset: () => this.native().destroy(),
    destroy: async () => {
      // Release only after physical destruction is acknowledged, including
      // cleanup after a failed or ambiguously acknowledged start.
      await this.native().destroy();
      const token = await this.ctx.storage.get<string>(tokenKey);
      if (token) {
        await this.coordinator().releaseCapacity(this.ctx.id.toString(), token);
        await this.ctx.storage.delete(tokenKey);
      }
      await this.ctx.storage.delete(cleanupKey);
      await this.ctx.storage.deleteAlarm();
    },
    start: async (signal) => {
      const token = (await this.ctx.storage.get<string>(tokenKey)) ?? crypto.randomUUID();
      await this.ctx.storage.put(tokenKey, token);
      await this.armCleanup();
      await processorStage("capacity_wait", () =>
        waitForProcessorCapacity(
          () => this.coordinator().claimCapacity(this.ctx.id.toString(), token),
          signal,
        ),
      );
      const container = this.native();
      await startNativeProcessor(
        {
          running: () => container.running,
          start: () => container.start({ enableInternet: false, env: {} }),
          monitor: () => container.monitor(),
          configureIdle: () => container.setInactivityTimeout(300_000),
          ready: async (readySignal) => {
            const response = await container
              .getTcpPort(8080)
              .fetch("http://processor.internal/ready", {
                signal: readySignal,
                redirect: "manual",
                headers: { "x-baro-readiness": "1" },
              });
            const ready = response.status === 200 && !response.redirected;
            await response.body?.cancel().catch(() => {});
            return ready;
          },
        },
        signal,
      );
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
    const prepared = await this.ctx.storage.transaction(async (storage) => {
      if (await storage.get("baro-native-revoked-v1")) throw new Error("REVOKED");
      const previous = await storage.get<string>(tokenKey);
      if (previous && previous !== token) return false;
      if (!previous) {
        const until = Date.now() + 300_000;
        await storage.put({ [tokenKey]: token, [cleanupKey]: until });
        await storage.setAlarm(until);
      }
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

  override async alarm(info?: AlarmInvocationInfo): Promise<void> {
    if (info?.isRetry && info.retryCount > 3) return;
    const until = await this.ctx.storage.get<number>(cleanupKey);
    if (until && until > Date.now()) {
      await this.ctx.storage.setAlarm(until);
      return;
    }
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
