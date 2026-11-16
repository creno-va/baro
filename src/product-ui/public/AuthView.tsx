import { LoaderCircle } from "lucide-react";
import { Button } from "../Button";
import { cn } from "../utils";
import { ProviderIcon, providers } from "./ProviderIcon";
import type { AuthController } from "./useAuthController";

export function AuthView({ controller: c }: { controller: AuthController }) {
  return (
    <div data-product-auth="" className="space-y-4" aria-busy={c.pendingProvider !== null}>
      {c.mock && (
        <p className="text-xs leading-6 text-[var(--pui-muted)]">
          API 예시 모드 · 합성 계정으로 시연합니다.
        </p>
      )}
      <fieldset className="space-y-3 border-0 p-0">
        <legend className="sr-only">소셜 계정으로 계속하기</legend>
        {providers.map((provider) => (
          <Button
            variant="secondary"
            className={cn("min-h-14 w-full justify-start gap-4 px-4 text-sm", {
              "border-[#fee500] bg-[#fee500] text-[#191919]": provider.id === "kakao",
              "border-[#03c75a] bg-[#03c75a] text-white": provider.id === "naver",
              "border-[var(--pui-border)] bg-white text-[#191919]": provider.id === "google",
            })}
            data-product-auth-provider={provider.id}
            disabled={!c.ready || c.pendingProvider !== null}
            aria-label={c.pendingProvider === provider.id ? "연결 중…" : provider.label}
            key={provider.id}
            onClick={(event) => {
              c.lastButton.current = event.currentTarget;
              void c.signIn(provider.id);
            }}
            type="button"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center [&_svg]:h-5 [&_svg]:w-5">
              {c.pendingProvider === provider.id ? (
                <LoaderCircle
                  size={20}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ProviderIcon provider={provider.id} />
              )}
            </span>
            <span aria-hidden="true">{provider.name}</span>
          </Button>
        ))}
      </fieldset>
      <p className="min-h-5 text-xs leading-5 text-[var(--pui-muted)]" role="status">
        {c.pendingProvider ? "로그인 페이지로 연결하고 있어요." : ""}
      </p>
      {c.error ? (
        <p
          className="rounded-xl border border-[var(--pui-danger)] p-3 text-sm leading-6 text-[var(--pui-danger)]"
          role="alert"
        >
          {c.error}
        </p>
      ) : null}
    </div>
  );
}
