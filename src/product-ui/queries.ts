import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const ownerSchema = z.strictObject({
  ownerId: z.string().min(1).max(128),
  generation: z.number().int().nonnegative(),
});
const caseScopeSchema = ownerSchema.extend({ caseId: z.string().min(1).max(128) });
export const productResourceSchema = z.enum([
  "case",
  "conversation",
  "materials",
  "report",
  "summary",
  "actions",
  "timeline",
]);
export type ProductQueryOwner = z.infer<typeof ownerSchema>;
export type ProductQueryScope = z.infer<typeof caseScopeSchema>;
export type ProductQueryResource = z.infer<typeof productResourceSchema>;

/** This factory is deliberately independent of auth and transport. Wire only
 * reviewed API reads later; never create a shared client during module import. */
export function createProductQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
        refetchIntervalInBackground: false,
      },
      mutations: { retry: false },
    },
  });
}

/** Generation belongs to the verified session integration, not the UI store.
 * A query key separates cache entries; it never grants server authorization. */
export const productQueryKeys = {
  owner(input: ProductQueryOwner) {
    const owner = ownerSchema.parse(input);
    return ["product-ui", owner.ownerId, owner.generation] as const;
  },
  case(input: ProductQueryScope) {
    const scope = caseScopeSchema.parse(input);
    return ["product-ui", scope.ownerId, scope.generation, scope.caseId] as const;
  },
  resource(input: ProductQueryScope, resource: ProductQueryResource) {
    const scope = caseScopeSchema.parse(input);
    return [
      "product-ui",
      scope.ownerId,
      scope.generation,
      scope.caseId,
      productResourceSchema.parse(resource),
    ] as const;
  },
};
