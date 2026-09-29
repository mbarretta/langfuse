import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LANGFUSE_DISABLE_OUTBOUND gate.
 *
 * Both the web env and the shared env (read by isEnterpriseLicenseAvailable)
 * are parsed from process.env at import time, so every case stubs the env,
 * resets the module registry and re-imports the helper. Importing
 * @langfuse/shared/src/env places this file in the shared-source vitest
 * project, so shared resolves to source and resetModules re-parses its env
 * (the CJS dist would keep the first parse). The logger is taken from the
 * same fresh registry so the spy sees the helper's calls.
 */

const EE_KEY = "langfuse_ee_test_key";
const PRO_KEY = "langfuse_pro_test_key";

const loadHelper = async () => {
  vi.resetModules();
  const { env: sharedEnv } = await import("@langfuse/shared/src/env");
  expect(sharedEnv.LANGFUSE_EE_LICENSE_KEY).toBe(
    process.env.LANGFUSE_EE_LICENSE_KEY,
  );
  const { logger } = await import("@langfuse/shared/src/server");
  const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  const { isOutboundDisabled } =
    await import("@/src/features/outbound/isOutboundDisabled");
  return { isOutboundDisabled, warnSpy };
};

describe("isOutboundDisabled", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", undefined);
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", undefined);
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is false when the flag is unset and no license key is present", async () => {
    const { isOutboundDisabled, warnSpy } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is false when the flag is unset and an enterprise key is present", async () => {
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", EE_KEY);

    const { isOutboundDisabled, warnSpy } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is false when the flag is "false" and an enterprise key is present', async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "false");
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", EE_KEY);

    const { isOutboundDisabled } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
  });

  it("is false and warns once per process when the flag is set without a license key", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");

    const { isOutboundDisabled, warnSpy } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
    expect(isOutboundDisabled()).toBe(false);
    expect(isOutboundDisabled()).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/enterprise license key/i);
  });

  it("is true when the flag is set and an enterprise key is present", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", EE_KEY);

    const { isOutboundDisabled, warnSpy } = await loadHelper();

    expect(isOutboundDisabled()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is false and warns when the flag is set with a pro key", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", PRO_KEY);

    const { isOutboundDisabled, warnSpy } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("is false on Langfuse Cloud even though Cloud counts as enterprise", async () => {
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", "US");

    const { isOutboundDisabled } = await loadHelper();

    expect(isOutboundDisabled()).toBe(false);
  });
});
