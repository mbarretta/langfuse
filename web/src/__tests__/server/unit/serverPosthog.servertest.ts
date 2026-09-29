import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Product-analytics region gate (server half).
 *
 * `ServerPosthog` is the single server-side entry point for Langfuse product
 * analytics (signup conversion, backend activity, self-host telemetry). In the
 * HIPAA cloud region it still constructs a `posthog-node` client, then opts it
 * out with `disable()` so capture becomes a no-op. That is enough on the
 * server: unlike the browser SDK, disable does not phone home.
 */

const {
  postHogConstructor,
  captureMock,
  disableMock,
  shutdownMock,
  flushMock,
} = vi.hoisted(() => ({
  postHogConstructor: vi.fn(),
  captureMock: vi.fn(),
  disableMock: vi.fn().mockResolvedValue(undefined),
  shutdownMock: vi.fn().mockResolvedValue(undefined),
  flushMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      postHogConstructor(...args);
    }
    capture = (...args: unknown[]) => {
      if (disableMock.mock.calls.length > 0) return;
      captureMock(...args);
    };
    disable = disableMock;
    shutdown = shutdownMock;
    flush = flushMock;
    debug = vi.fn();
  },
}));

const loadServerPosthog = async () => {
  vi.resetModules();
  const { ServerPosthog } =
    await import("@/src/features/posthog-analytics/ServerPosthog");
  return new ServerPosthog();
};

const captureArgs = {
  distinctId: "user-1",
  event: "backend:activity",
} as const;

describe("ServerPosthog product analytics region gate", () => {
  beforeEach(() => {
    postHogConstructor.mockClear();
    captureMock.mockClear();
    disableMock.mockClear();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables the client in the HIPAA cloud region so capture is a no-op", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", "HIPAA");

    const posthog = await loadServerPosthog();
    posthog.capture(captureArgs);
    await posthog.flush();
    await posthog.shutdown();

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("still disables the HIPAA client when it is built from the telemetry fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", "HIPAA");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", undefined);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", undefined);

    const posthog = await loadServerPosthog();
    posthog.capture(captureArgs);

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it.each([["US"], ["EU"], ["JP"]])("keeps capturing in %s", async (region) => {
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", region);

    const posthog = await loadServerPosthog();
    posthog.capture(captureArgs);

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect(disableMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledWith(captureArgs);
  });
});

/**
 * LANGFUSE_DISABLE_OUTBOUND gate. The real isOutboundDisabled() runs here:
 * importing @langfuse/shared/src/env routes this file to the shared-source
 * vitest project, so resetModules re-parses LANGFUSE_EE_LICENSE_KEY.
 */
describe("ServerPosthog outbound gate", () => {
  const loadWithSharedEnv = async () => {
    vi.resetModules();
    const { env: sharedEnv } = await import("@langfuse/shared/src/env");
    expect(sharedEnv.LANGFUSE_EE_LICENSE_KEY).toBe(
      process.env.LANGFUSE_EE_LICENSE_KEY,
    );
    const { ServerPosthog } =
      await import("@/src/features/posthog-analytics/ServerPosthog");
    return new ServerPosthog();
  };

  beforeEach(() => {
    postHogConstructor.mockClear();
    captureMock.mockClear();
    disableMock.mockClear();
    shutdownMock.mockClear();
    flushMock.mockClear();
    vi.stubEnv("NEXT_PUBLIC_LANGFUSE_CLOUD_REGION", undefined);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    vi.stubEnv("LANGFUSE_DISABLE_OUTBOUND", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never constructs a PostHog client when the flag is active with an EE key", async () => {
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", "langfuse_ee_test_key");

    const posthog = await loadWithSharedEnv();
    posthog.capture(captureArgs);
    await posthog.flush();
    await posthog.shutdown();

    expect(postHogConstructor).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
    expect(flushMock).not.toHaveBeenCalled();
    expect(shutdownMock).not.toHaveBeenCalled();
  });

  it("still constructs the client when the flag is set without an EE key", async () => {
    vi.stubEnv("LANGFUSE_EE_LICENSE_KEY", undefined);

    const posthog = await loadWithSharedEnv();
    posthog.capture(captureArgs);

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(captureArgs);
  });
});
