import { Linking } from "react-native";
import { createAccountDeletionModel } from "../features/account-deletion/model";
import { getDeletionAttemptStore } from "./auth-attempt";
import { readMobileConfig } from "./config";
import { getNativeDeletion } from "./deletion";
import { getMobileAuthClient } from "./mobile-auth";
import { getSessionModel } from "./session";

let model: ReturnType<typeof createAccountDeletionModel> | undefined;
export function getAccountDeletionModel() {
  model ??= createAccountDeletionModel({
    config: readMobileConfig(),
    session: getSessionModel(),
    client: getMobileAuthClient(),
    native: getNativeDeletion(),
    attempts: getDeletionAttemptStore(),
    openAppleHelp: () => Linking.openURL("https://support.apple.com/102571"),
  });
  return model;
}
