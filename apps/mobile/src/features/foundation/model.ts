import { V2_INTAKE_POLICY } from "@baro/contracts/v2/common";
import type { MobileConfig } from "../../../config/environment";

export type FoundationModel =
  | { kind: "available"; questionHint: string }
  | { kind: "configuration-error"; message: string };

/** M1 has no session or API adapter. A valid config never implies authentication or connectivity. */
export function createFoundationModel(readConfig: () => MobileConfig): FoundationModel {
  try {
    readConfig();
    return {
      kind: "available",
      questionHint: `한 번에 최대 ${V2_INTAKE_POLICY.questionsPerBatch}개의 질문으로 필요한 사실을 정리해요.`,
    };
  } catch {
    // Never render thrown config values or an endpoint carrying sensitive data.
    return {
      kind: "configuration-error",
      message: "앱 설정을 확인할 수 없어요. 앱을 다시 열어 주세요.",
    };
  }
}
