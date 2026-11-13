import { type ClassValue, clsx } from "clsx";
import { useSyncExternalStore } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const subscribeClient = () => () => {};
/** Headless structural widgets emit inline SSR sentinels; hydrate them under the hash CSP. */
export function useClientReady() {
  return useSyncExternalStore(
    subscribeClient,
    () => true,
    () => false,
  );
}

/** Omit undefined React props at the strict Headless UI boundary. */
export function definedProps<T extends object>(
  props: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
