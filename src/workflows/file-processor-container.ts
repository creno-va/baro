import { Container } from "@cloudflare/containers";
import { createProcessorLifecycle } from "../server/modules/file-processing/container-lifecycle";

/** One named attempt, with a clean native instance per bounded step. */
export class FileProcessorContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override enableInternet = false;
  override envVars = {};
  private lifecycle = createProcessorLifecycle({
    isRevoked: async () => (await this.ctx.storage.get("baro-native-revoked-v1")) === true,
    persistRevoked: () => this.ctx.storage.put("baro-native-revoked-v1", true),
    destroy: () => this.destroy(),
    start: (signal) =>
      this.startAndWaitForPorts({
        ports: [8080],
        cancellationOptions: {
          abort: signal,
          instanceGetTimeoutMS: 15_000,
          portReadyTimeoutMS: 20_000,
        },
        startOptions: { enableInternet: false, envVars: {} },
      }),
    fetch: async (incoming) => {
      const container = this.ctx.container;
      if (!container) throw new Error("PROCESSOR_UNAVAILABLE");
      // SDK convenience proxy logs exceptions; use the platform port directly.
      return container.getTcpPort(8080).fetch(incoming);
    },
  });

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
