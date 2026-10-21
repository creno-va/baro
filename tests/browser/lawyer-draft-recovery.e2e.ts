import { expect, test } from "@playwright/test";
import { emptySelfProfile } from "../../src/server/modules/lawyers/self-profile-contract";

test("publication confirmation preserves edits made after opening it", async ({ page }) => {
  let publications = 0;
  const profile = {
    id: "synthetic-profile",
    revision: 2,
    name: "Synthetic lawyer",
    introduction: "Saved introduction",
    officeName: "Synthetic office",
    address: "Synthetic address",
    region: "",
    practiceAreas: [],
    phone: "010-1234-5678",
    email: "",
    website: "",
    photoAssetId: null,
    photoUrl: null,
    portfolio: [],
    published: false,
    verificationStatus: "self_declared",
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
          needsConsent: false,
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile") return route.fulfill({ json: profile });
    if (path.endsWith("/publication")) {
      publications++;
      return route.fulfill({ json: profile });
    }
    if (path.endsWith("/assets")) return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/lawyer");
  const intro = page.locator("textarea").first();
  await expect(intro).toHaveValue(profile.introduction);
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await intro.fill("Unsaved revised introduction");
  await page
    .getByLabel("내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.", { exact: true })
    .check();
  await expect(page.getByRole("button", { name: "동의하고 공개", exact: true })).toBeDisabled();
  await expect(intro).toHaveValue("Unsaved revised introduction");
  expect(publications).toBe(0);
});

test("selecting another ready photo replaces an uploaded photo preview before saving", async ({
  page,
}) => {
  let photoBReads = 0;
  let savedPhoto: string | null = null;
  let profile = {
    id: "synthetic-photo-profile",
    revision: 2,
    name: "Synthetic lawyer",
    introduction: "Saved introduction",
    officeName: "Synthetic office",
    address: "Synthetic address",
    region: "",
    practiceAreas: [],
    phone: "010-1234-5678",
    email: "",
    website: "",
    photoAssetId: null,
    photoUrl: null,
    portfolio: [],
    published: false,
    verificationStatus: "self_declared",
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
          needsConsent: false,
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile") {
      if (req.method() === "PUT") {
        savedPhoto = req.postDataJSON().profile.photoAssetId;
        profile = { ...req.postDataJSON().profile, revision: profile.revision + 1 };
      }
      return route.fulfill({ json: profile });
    }
    if (path === "/api/v2/me/lawyer/profile")
      return route.fulfill({ json: { profileId: profile.id, revision: 1 } });
    if (path === "/api/v2/me/lawyer/portfolio-assets")
      return route.fulfill({
        json: {
          assetId: "synthetic-photo-a",
          revision: 1,
          value: { request: { mediaType: "image/jpeg" } },
        },
      });
    if (path === "/api/v2/me/lawyer/assets/synthetic-photo-a/content")
      return route.fulfill({
        json: {
          assetId: "synthetic-photo-a",
          revision: 3,
          value: {
            id: "synthetic-photo-a",
            revision: 3,
            kind: "image",
            status: "ready",
            byteLength: 1000,
            originalHash: "a".repeat(64),
            sanitizedDerivative: {
              id: "synthetic-photo-a-derivative",
              contentHash: "a".repeat(64),
              byteLength: 1000,
              format: "jpeg",
            },
            currentJobId: null,
            failure: null,
          },
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile/assets")
      return route.fulfill({
        json: {
          items: ["a", "b"].map((id) => ({
            id: `synthetic-photo-${id}`,
            revision: 3,
            status: "ready",
            purpose: "profile_photo",
          })),
          nextCursor: null,
        },
      });
    if (path.endsWith("/self-profile/assets/synthetic-photo-b/content")) {
      photoBReads++;
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw2kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/lawyer");
  await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const context = canvas.getContext("2d");
    context?.fillRect(0, 0, 24, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("프로필 사진", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png ?? "", "base64"),
  });
  const image = page.getByAltText("내 프로필 사진", { exact: true });
  await expect(image).toHaveAttribute("src", /^data:image/);
  await page.getByRole("button", { name: "자료 상태 확인", exact: true }).click();
  const rows = page.getByRole("list", { name: "업로드 자료 상태" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole("button", { name: "프로필에 연결", exact: true }).click();
  await expect.poll(() => photoBReads).toBeGreaterThan(0);
  await expect(image).toHaveAttribute("src", /^data:image\/png/);
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  expect(savedPhoto).toBe("synthetic-photo-b");
});

for (const outageMode of ["save", "focus", "postflight"] as const) {
  test(`temporary session outage preserves the profile draft: ${outageMode}`, async ({ page }) => {
    let outage = false,
      writes = 0;
    let profile = {
      id: "synthetic-outage-profile",
      revision: 2,
      name: "Synthetic lawyer",
      introduction: "Saved introduction",
      officeName: "Synthetic office",
      address: "Synthetic address",
      region: "",
      practiceAreas: [],
      phone: "010-1234-5678",
      email: "",
      website: "",
      photoAssetId: null,
      photoUrl: null,
      portfolio: [],
      published: false,
      verificationStatus: "self_declared",
    } as import("../../src/server/modules/lawyers/self-profile-contract").SelfProfile;
    const { isDuplicateProfileSave } = await import(
      "../../src/server/modules/lawyers/self-profile-contract"
    );
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session")
        return outage
          ? route.fulfill({
              status: 503,
              json: { error: { code: "INTERNAL_ERROR", retryable: true } },
            })
          : route.fulfill({
              json: {
                user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
                needsConsent: false,
              },
            });
      if (path === "/api/v2/me/lawyer/self-profile") {
        if (req.method() === "PUT") {
          const next = req.postDataJSON().profile;
          if (isDuplicateProfileSave(profile, next)) return route.fulfill({ json: profile });
          expect(next.revision).toBe(profile.revision);
          profile = { ...next, revision: profile.revision + 1 };
          writes++;
          if (outageMode === "postflight" && writes === 1) outage = true;
        }
        return route.fulfill({ json: profile });
      }
      if (path.endsWith("/assets")) return route.fulfill({ json: { items: [], nextCursor: null } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/lawyer");
    const intro = page.locator("textarea").first();
    await expect(intro).toHaveValue(profile.introduction);
    await intro.fill("Synthetic unsaved introduction");
    if (outageMode !== "postflight") outage = true;
    if (outageMode === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    else await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    await expect(intro).toHaveCount(0);
    const recover = page.getByRole("button", { name: "로그인 상태 다시 확인", exact: true });
    await expect(recover).toBeEnabled();
    expect(writes).toBe(outageMode === "postflight" ? 1 : 0);
    outage = false;
    await recover.click();
    await expect(intro).toHaveValue("Synthetic unsaved introduction");
    await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    expect(profile.introduction).toBe("Synthetic unsaved introduction");
  });
}

for (const nextSession of ["other-owner", "signed-out", "expired"] as const) {
  test(`outage draft is discarded after a confirmed session change: ${nextSession}`, async ({
    page,
  }) => {
    let outage = false,
      owner = "synthetic-owner";
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session" && !outage && !owner && nextSession === "expired")
        return route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHENTICATED", retryable: false } },
        });
      if (path === "/api/me/session")
        return outage
          ? route.fulfill({
              status: 503,
              json: { error: { code: "INTERNAL_ERROR", retryable: true } },
            })
          : route.fulfill({
              json: {
                user: owner ? { id: owner, name: "Synthetic", accountType: "lawyer" } : null,
                needsConsent: false,
              },
            });
      if (path === "/api/v2/me/lawyer/self-profile")
        return route.fulfill({
          json: {
            id: "synthetic-profile",
            revision: 2,
            name: "Synthetic lawyer",
            introduction:
              owner === "synthetic-owner" ? "Saved introduction" : "New owner introduction",
            officeName: "Synthetic office",
            address: "Synthetic address",
            region: "",
            practiceAreas: [],
            phone: "010-1234-5678",
            email: "",
            website: "",
            photoAssetId: null,
            photoUrl: null,
            portfolio: [],
            published: false,
            verificationStatus: "self_declared",
          },
        });
      if (path.endsWith("/assets")) return route.fulfill({ json: { items: [], nextCursor: null } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/lawyer");
    const intro = page.locator("textarea").first();
    await expect(intro).toHaveValue("Saved introduction");
    await intro.fill("Old owner unsaved draft");
    outage = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(intro).toHaveCount(0);
    outage = false;
    owner = nextSession === "other-owner" ? "synthetic-next-owner" : "";
    await page.getByRole("button", { name: "로그인 상태 다시 확인", exact: true }).click();
    if (owner) await expect(intro).toHaveValue("New owner introduction");
    else {
      await expect(intro).toHaveCount(0);
      await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
    }
    await expect(page.getByText("Old owner unsaved draft", { exact: true })).toHaveCount(0);
  });
}

for (const purpose of ["photo", "pdf"] as const) {
  for (const stage of ["preflight", "postflight"] as const) {
    for (const outcome of [
      "same",
      "other-owner",
      "signed-out",
      "customer",
      "consent",
      "unavailable",
    ] as const) {
      if (outcome !== "same" && purpose !== "pdf") continue;
      test(`file picker ${outcome === "same" ? "focus" : "session invalidation"} ${purpose} upload ${stage}: ${outcome}`, async ({
        page,
      }) => {
        let session: {
          user: { id: string; name: string; accountType: "lawyer" | "customer" } | null;
          needsConsent: boolean;
        } = {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
          needsConsent: false,
        };
        const profile = {
          id: "synthetic-focus-profile",
          revision: 2,
          name: "Synthetic lawyer",
          introduction: "Saved introduction",
          officeName: "Synthetic office",
          address: "Synthetic address",
          region: "",
          practiceAreas: [],
          phone: "010-1234-5678",
          email: "",
          website: "",
          photoAssetId: null,
          photoUrl: null,
          portfolio: [],
          published: false,
          verificationStatus: "self_declared",
        };
        let holdSessions = false;
        let unavailable = false;
        const pending: (() => Promise<void>)[] = [];
        let uploads = 0;
        let uploadedBytes = 0;
        let sessionRequests = 0;
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (!path.startsWith("/api/")) return route.continue();
          if (path === "/api/me/session") {
            sessionRequests++;
            const response = unavailable
              ? { status: 503, json: { error: { code: "INTERNAL_ERROR", retryable: true } } }
              : { json: session };
            if (holdSessions) {
              pending.push(() => route.fulfill(response));
              return;
            }
            return route.fulfill(response);
          }
          if (path === "/api/v2/me/lawyer/self-profile")
            return route.fulfill({
              json: {
                ...profile,
                introduction:
                  session.user?.id === "synthetic-next-owner"
                    ? "New owner introduction"
                    : profile.introduction,
              },
            });
          if (path === "/api/v2/me/lawyer/profile")
            return route.fulfill({ json: { profileId: profile.id, revision: 1 } });
          if (path === "/api/v2/me/lawyer/portfolio-assets")
            return route.fulfill({
              json: {
                assetId: "synthetic-focus-asset",
                revision: 1,
                value: {
                  request: { mediaType: purpose === "photo" ? "image/jpeg" : "application/pdf" },
                },
              },
            });
          if (path === "/api/v2/me/lawyer/assets/synthetic-focus-asset/content") {
            uploads++;
            uploadedBytes = request.postDataBuffer()?.length ?? 0;
            if (stage === "postflight") holdSessions = true;
            return route.fulfill({
              json: {
                assetId: "synthetic-focus-asset",
                revision: 3,
                value: {
                  id: "synthetic-focus-asset",
                  revision: 3,
                  kind: purpose === "photo" ? "image" : "pdf",
                  status: "ready",
                  byteLength: uploadedBytes,
                  originalHash: "a".repeat(64),
                  sanitizedDerivative: {
                    id: "synthetic-focus-derivative",
                    contentHash: "a".repeat(64),
                    byteLength: uploadedBytes,
                    format: purpose === "photo" ? "jpeg" : "pdf",
                  },
                  currentJobId: null,
                  failure: null,
                },
              },
            });
          }
          return route.fulfill({ status: 404, json: {} });
        });
        await page.goto("/lawyer");
        await expect(page.getByLabel("이름", { exact: true })).toBeEnabled();
        await page.evaluate(async () => {
          const path = "/src/client/api/session.ts";
          const { sessionApi } = (await import(
            path
          )) as typeof import("../../src/client/api/session");
          const tracker = window as unknown as { profileSessionReads: number };
          tracker.profileSessionReads = 0;
          const get = sessionApi.get;
          sessionApi.get = async (...args: Parameters<typeof get>) => {
            tracker.profileSessionReads++;
            return get(...args);
          };
        });
        const sessionReads = () =>
          page.evaluate(
            () => (window as unknown as { profileSessionReads: number }).profileSessionReads,
          );
        const png = await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 24;
          canvas.getContext("2d")?.fillRect(0, 0, 24, 24);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        holdSessions = stage === "preflight";
        await page
          .getByLabel(purpose === "photo" ? "프로필 사진" : "포트폴리오 파일 (이미지·PDF)", {
            exact: true,
          })
          .setInputFiles({
            name: purpose === "photo" ? "synthetic.png" : "synthetic.pdf",
            mimeType: purpose === "photo" ? "image/png" : "application/pdf",
            buffer:
              purpose === "photo"
                ? Buffer.from(png ?? "", "base64")
                : Buffer.from("%PDF-1.4\nSynthetic fixture\n%%EOF"),
          });
        await expect.poll(() => pending.length).toBe(1);
        await expect(
          page.getByRole("status").filter({
            hasText:
              stage === "preflight"
                ? "업로드 전 로그인 상태를 확인하고 있어요."
                : "업로드 결과를 확인하고 있어요.",
          }),
        ).toBeVisible();
        // The saved-profile button must not claim that a file upload is a save.
        await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeDisabled();
        if (outcome === "other-owner")
          session = {
            ...session,
            user: { id: "synthetic-next-owner", name: "Synthetic next", accountType: "lawyer" },
          };
        if (outcome === "signed-out") session = { user: null, needsConsent: false };
        if (outcome === "customer")
          session = {
            ...session,
            user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          };
        if (outcome === "consent") session = { ...session, needsConsent: true };
        if (outcome === "unavailable") unavailable = true;
        const readsBeforeEvent = await sessionReads();
        await page.evaluate((same) => {
          window.dispatchEvent(
            same
              ? new Event("focus")
              : new StorageEvent("storage", {
                  key: "baro-session-changed",
                  newValue: "synthetic-account-invalidation",
                }),
          );
        }, outcome === "same");
        // Prove the event actually invoked verification. Ordinary file-picker
        // focus shares the held HTTP read; an explicit peer invalidation must
        // bypass it and obtain a new authoritative account/consent response.
        await expect.poll(sessionReads).toBeGreaterThan(readsBeforeEvent);
        if (outcome === "same") expect(pending).toHaveLength(1);
        else await expect.poll(() => pending.length).toBeGreaterThan(1);
        // Resolve invalidation checks before the old owner's captured response.
        // No old response may restore permissions or attach an upload afterwards.
        holdSessions = false;
        await Promise.all(pending.slice(1).map((release) => release()));
        await pending[0]?.();
        if (outcome !== "same") {
          if (outcome === "other-owner")
            await expect(page.locator("textarea").first()).toHaveValue("New owner introduction");
          else if (outcome === "signed-out" || outcome === "customer")
            await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
          else if (outcome === "consent")
            await expect(
              page.getByText("재동의 전에도 기존 프로필과 자료를 확인할 수 있어요.", {
                exact: true,
              }),
            ).toBeVisible();
          else
            await expect(
              page.getByRole("button", { name: "로그인 상태 다시 확인", exact: true }),
            ).toBeEnabled();
          await expect(page.getByRole("list", { name: "업로드 자료 상태" })).toHaveCount(0);
          await expect(
            page.getByText("자료를 연결했어요. 프로필을 저장하면 반영돼요.", { exact: true }),
          ).toHaveCount(0);
          expect(uploads).toBe(stage === "postflight" ? 1 : 0);
          return;
        }
        await expect(
          page.getByRole("list", { name: "업로드 자료 상태" }).getByRole("listitem"),
        ).toHaveCount(1);
        await expect(
          page.getByText("자료를 연결했어요. 프로필을 저장하면 반영돼요.", { exact: true }),
        ).toBeVisible();
        expect(uploads).toBe(1);
        expect(uploadedBytes).toBeGreaterThan(0);
        if (purpose === "photo")
          await expect(page.getByAltText("내 프로필 사진", { exact: true })).toHaveAttribute(
            "src",
            /^data:image/,
          );
        else await expect(page.getByLabel("활동 제목 1", { exact: true })).toHaveValue("공개 자료");
        await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeEnabled();
        const settledSessionReads = sessionRequests;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => sessionRequests).toBeGreaterThan(settledSessionReads);
        // Sharing must end when the response settles: the next foreground check
        // reads current permissions while keeping the connected unsaved asset.
        await expect(
          page.getByRole("list", { name: "업로드 자료 상태" }).getByRole("listitem"),
        ).toHaveCount(1);
        expect(uploads).toBe(1);
      });
    }
  }
}

for (const action of ["save", "publish", "assets"] as const) {
  test(`profile shows the pending operation and clears it on completion: ${action}`, async ({
    page,
  }) => {
    let profile = {
      ...emptySelfProfile("synthetic-progress-profile"),
      name: "Synthetic",
      phone: "010-1234-5678",
    };
    let release: (() => Promise<void>) | undefined;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session")
        return route.fulfill({
          json: {
            user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
            needsConsent: false,
          },
        });
      if (path === "/api/v2/me/lawyer/self-profile" && request.method() === "GET")
        return route.fulfill({ json: profile });
      if (path === "/api/v2/me/lawyer/self-profile/assets") {
        release = () => route.fulfill({ json: { items: [], nextCursor: null } });
        return;
      }
      if (path === "/api/v2/me/lawyer/self-profile" || path.endsWith("/publication")) {
        profile = path.endsWith("/publication")
          ? { ...profile, published: true, revision: profile.revision + 1 }
          : { ...request.postDataJSON().profile, revision: profile.revision + 1 };
        release = () => route.fulfill({ json: profile });
        return;
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/lawyer");
    await expect(page.getByLabel("이름", { exact: true })).toBeEnabled();
    if (action === "save") {
      await page.locator("textarea").first().fill("Synthetic revised introduction");
      await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    } else if (action === "publish") {
      await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
      await page
        .getByLabel("내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.", { exact: true })
        .check();
      await page.getByRole("button", { name: "동의하고 공개", exact: true }).click();
    } else await page.getByRole("button", { name: "자료 상태 확인", exact: true }).click();
    await expect.poll(() => !!release).toBe(true);
    const message = {
      save: "프로필을 저장하고 있어요.",
      publish: "프로필을 공개하고 있어요.",
      assets: "업로드 자료 상태를 확인하고 있어요.",
    }[action];
    await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
    await expect(page.getByLabel("이름", { exact: true })).toBeDisabled();
    await release?.();
    await expect(page.getByRole("status").filter({ hasText: message })).toHaveCount(0);
    await expect(page.getByLabel("이름", { exact: true })).toBeEnabled();
    await expect(
      page.getByText(
        {
          save: "프로필을 저장했어요.",
          publish: "프로필을 공개했어요. 디렉터리에서 확인할 수 있어요.",
          assets: "업로드한 자료가 없어요.",
        }[action],
        { exact: true },
      ),
    ).toBeVisible();
  });
}
