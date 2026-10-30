import { timestampSchema } from "../../../contracts";

/** Trusted local tool: no provider, user input, network call or case fact. */
export function currentTime(clock: () => string = () => new Date().toISOString()) {
  const utc = new Date(timestampSchema.parse(clock())).toISOString();
  const local = new Date(Date.parse(utc) + 9 * 3600000).toISOString();
  return {
    tool: "current_time" as const,
    utc,
    localDate: local.slice(0, 10),
    localTime: local.slice(11, 19),
    timeZone: "Asia/Seoul" as const,
  };
}
