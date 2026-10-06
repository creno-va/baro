import { Container } from "@cloudflare/containers";
import { proxyProcessorRequest } from "../server/modules/file-processing/container-proxy";

/** One bounded native step per instance. This binding has no public HTTP route. */
export class FileProcessorContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override enableInternet = false;
  override envVars = {};
  private busy = false;

  override onError(): void {}

  override async onActivityExpired(): Promise<void> {
    await this.stop("SIGKILL");
  }

  override async fetch(request: Request): Promise<Response> {
    if (this.busy) return Response.json({ code: "BUSY" }, { status: 409 });
    this.busy = true;
    return proxyProcessorRequest(request, {
      start: async (signal) => {
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
      stop: async () => {
        await this.stop("SIGKILL");
        this.busy = false;
      },
    }).then((response) => {
      if (response.status === 400) this.busy = false;
      return response;
    });
  }
}
