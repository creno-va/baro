import { describe, expect, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ProductUIProvider, useProductUI } from "../src/product-ui/Provider";
import { createProductQueryClient, productQueryKeys } from "../src/product-ui/queries";
import {
  createProductUIStore,
  type ProductUIState,
  productUIStateSchema,
} from "../src/product-ui/state";

const initial = {
  sidebarCollapsed: false,
  mobileNavigationOpen: false,
  activePanel: "conversation",
  theme: "system",
};

describe("product UI state ownership", () => {
  test("each store isolates UI interactions and reset restores its own validated seed", () => {
    const first = createProductUIStore({ activePanel: "report" }, { theme: "dark" });
    const second = createProductUIStore();
    first.getState().setActivePanel("materials");
    first.getState().setMobileNavigationOpen(true);
    first.getState().setSidebarCollapsed(true);
    first.getState().setTheme("light");
    expect(second.getState()).toMatchObject(initial);
    second.getState().setTheme("light");
    first.getState().reset();
    expect(first.getState()).toMatchObject({ ...initial, activePanel: "report", theme: "dark" });
    expect(second.getState().theme).toBe("light");
    expect(first.getState().setTheme).toBeFunction();
  });

  test("explicit initial UI values override optional preferences deterministically", () => {
    const store = createProductUIStore(
      { theme: "system", sidebarCollapsed: false },
      { theme: "dark", sidebarCollapsed: true },
    );
    expect(store.getState()).toMatchObject(initial);
    expect(
      createProductUIStore({ theme: undefined }, { sidebarCollapsed: undefined }).getState(),
    ).toMatchObject(initial);
  });

  test("unexpected private data is rejected instead of entering initial state or preferences", () => {
    for (const value of [
      { caseId: "synthetic-case" },
      { messages: ["synthetic message"] },
      { files: [] },
      { user: { id: "synthetic-owner" } },
      { authToken: "synthetic-token" },
    ]) {
      expect(() => createProductUIStore(value)).toThrow();
      expect(() => createProductUIStore({}, value)).toThrow();
    }
    expect(() => createProductUIStore({ activePanel: "private-case" })).toThrow();
    expect(() => createProductUIStore({}, { mobileNavigationOpen: true })).toThrow();
    expect(productUIStateSchema.safeParse(initial).success).toBe(true);
  });

  test("provider SSR is deterministic and each render owns fresh UI and query state", () => {
    const clients: ReturnType<typeof createProductQueryClient>[] = [];
    const themeSetters: ProductUIState["setTheme"][] = [];
    function Inspect() {
      const theme = useProductUI((state) => state.theme);
      const panel = useProductUI((state) => state.activePanel);
      themeSetters.push(useProductUI((state) => state.setTheme));
      const query = useQueryClient();
      clients.push(query);
      return createElement(
        "span",
        null,
        `${theme}:${panel}:${query.getQueryCache().getAll().length}`,
      );
    }
    const render = () =>
      renderToString(createElement(ProductUIProvider, null, createElement(Inspect)));
    const first = render();
    clients[0]?.setQueryData(["synthetic-private-data"], "isolated first render");
    themeSetters[0]?.("dark");
    expect(render()).toBe(first);
    expect(first).toBe("<span>system:conversation:0</span>");
    expect(clients[0]).not.toBe(clients[1]);
    for (const client of clients) client.clear();
  });
});

describe("product query defaults and identity", () => {
  test("owner, generation, case and resource separate private cache entries", () => {
    const client = createProductQueryClient();
    const scope = { ownerId: "synthetic-owner", generation: 1, caseId: "synthetic-case" };
    const key = productQueryKeys.resource(scope, "conversation");
    client.setQueryData(key, "synthetic conversation");
    expect(
      client.getQueryData(productQueryKeys.resource({ ...scope, generation: 2 }, "conversation")),
    ).toBeUndefined();
    expect(
      client.getQueryData(
        productQueryKeys.resource({ ...scope, ownerId: "other-owner" }, "conversation"),
      ),
    ).toBeUndefined();
    expect(
      client.getQueryData(
        productQueryKeys.resource({ ...scope, caseId: "other-case" }, "conversation"),
      ),
    ).toBeUndefined();
    expect(client.getQueryData(productQueryKeys.resource(scope, "materials"))).toBeUndefined();
    expect(client.getQueryData<string>(key)).toBe("synthetic conversation");
    expect(() => productQueryKeys.resource({ ...scope, generation: -1 }, "report")).toThrow();
    client.clear();
  });

  test("query clients isolate caches and leave passive reads free of automatic polling", () => {
    const first = createProductQueryClient(),
      second = createProductQueryClient();
    first.setQueryData(["synthetic-resource"], "first client only");
    expect(second.getQueryData(["synthetic-resource"])).toBeUndefined();
    expect(first.getDefaultOptions().queries).toMatchObject({
      staleTime: 15_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    });
    first.clear();
    second.clear();
  });

  test("an uncertain mutation makes one attempt without automatic replay", async () => {
    const client = createProductQueryClient();
    let attempts = 0;
    const error = new Error("synthetic uncertain acknowledgement");
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        attempts++;
        throw error;
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(attempts).toBe(1);
    client.clear();
  });
});
