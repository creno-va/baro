import { ApiError } from "@baro/api-client";

/** The final credential reset owns its own generation fence. No server mutation or recovery-store clear. */
export function createAccountCleanup(dependencies: {
  resetPrivateFiles(): Promise<void>;
  cancelLogin(options: { signOut: true }): Promise<void>;
}) {
  return async ({ ensureCurrent }: { ownerId: string; ensureCurrent(): void }) => {
    ensureCurrent();
    let fileCleanupFailed = false;
    try {
      await dependencies.resetPrivateFiles();
    } catch {
      fileCleanupFailed = true;
    }
    ensureCurrent();
    // SessionModel invalidates the scope synchronously before every new login/reauthentication.
    // Do not await anything between this fence and NativeLogin's synchronous cancel/reset.
    await dependencies.cancelLogin({ signOut: true });
    if (fileCleanupFailed)
      throw new ApiError(
        "UNAVAILABLE",
        "계정 삭제는 접수됐지만 기기 내 자료를 모두 정리하지 못했어요.",
        true,
      );
  };
}
