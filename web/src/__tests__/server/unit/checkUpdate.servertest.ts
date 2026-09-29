import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { testFeatureFlags } from "@/src/__tests__/fixtures/feature-flags";

/**
 * public.checkUpdate must not call langfuse.com when LANGFUSE_DISABLE_OUTBOUND
 * is active. The real isOutboundDisabled() runs: importing
 * @langfuse/shared/src/env routes this file to the shared-source vitest
 * project, so resetModules re-parses LANGFUSE_EE_LICENSE_KEY.
 */

const session: Session = {
  expires: "1",
  user: {
    id: "check-update-user",
    canCreateOrganizations: true,
    name: "Check Update Test User",
    organizations: [],
    featureFlags: testFeatureFlags(),
    admin: false,
  },
  environment: {
    enableExperimentalFeatures: false,
    selfHostedInstancePlan: "self-hosted:enterprise",
  },
};

const loadCaller = async () => {
  vi.resetModules();
  const { env: sharedEnv } = await import("@langfuse/shared/src/env");
  expect(sharedEnv.LANGFUSE_EE_LICENSE_KEY).toBe(
    process.env.LANGFUSE_EE_LICENSE_KEY,
  );
  const { publicRouter } = await import("@/src/server/api/routers/public");
  const { createInnerTRPCContext } = await import("@/src/server/api/trpc");
  return publicRouter.createCaller(
    createInnerTRPCContext({ session, headers: {} }),
  );
};

describe("public.checkUpdate outbound gate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", undefined);
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", "langfuse_ee_test_key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns null without calling fetch when the flag is active", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");

    const caller = await loadCaller();

    await expect(caller.checkUpdate()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the release API when the flag is not set", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", undefined);

    const caller = await loadCaller();
    await caller.checkUpdate();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "https://langfuse.com/api/latest-releases",
    );
  });
});
