import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import type { UsageCounts } from "@/src/features/telemetry/usageCounts";

/**
 * GET /api/admin/usage-report. collectUsageCounts() (covered by
 * telemetry.servertest.ts) and the cron_jobs lookup are mocked, so no case
 * touches a database; global fetch is spied on to prove the handler itself
 * makes no outbound call (collectUsageCounts reads only Postgres and
 * ClickHouse, see telemetry.servertest.ts).
 */

const { envMock, collectUsageCountsMock, findUniqueMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, unknown>,
  collectUsageCountsMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/src/env.mjs", async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> };
  Object.assign(envMock, actual.env);
  return { env: envMock };
});

vi.mock("@/src/features/telemetry/usageCounts", () => ({
  collectUsageCounts: collectUsageCountsMock,
}));

vi.mock("@langfuse/shared/src/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: { cronJobs: { findUnique: findUniqueMock } } };
});

import handler from "@/src/pages/api/admin/usage-report";
import { VERSION } from "@/src/constants";

const ADMIN_API_KEY = "test-admin-api-key";
const LICENSE_KEY = "langfuse_ee_0123456789abcdefWXYZ";
const CLIENT_ID = "3f0c2a8e-6f4b-4a57-9a1e-0d6b2c1e9f10";
const COUNTS = {
  totalProjects: 2,
  traces: 10,
  scores: 3,
  observations: 40,
  datasets: 1,
  datasetItems: 5,
  datasetRuns: 2,
  datasetRunItems: 7,
  assistantRuns: 4,
  userDomains: [{ domain: "example.com", userCount: 3 }],
} satisfies UsageCounts;

const callHandler = async ({
  method = "GET",
  authorization = `Bearer ${ADMIN_API_KEY}`,
  query = {},
}: {
  method?: "GET" | "POST";
  authorization?: string | null;
  query?: Record<string, string | string[]>;
} = {}) => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method,
    headers: authorization === null ? {} : { authorization },
    query,
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: res._getJSONData() };
};

describe("GET /api/admin/usage-report", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envMock.ADMIN_API_KEY = ADMIN_API_KEY;
    envMock.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION = undefined;
    envMock.LANGFUSE_EE_LICENSE_KEY = LICENSE_KEY;
    envMock.LANGFUSE_DISABLE_OUTBOUND = undefined;
    collectUsageCountsMock.mockReset().mockResolvedValue(COUNTS);
    findUniqueMock.mockReset().mockResolvedValue({ state: CLIENT_ID });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("auth and method", () => {
    it("returns 401 without an authorization header", async () => {
      const { status } = await callHandler({ authorization: null });
      expect(status).toBe(401);
      expect(collectUsageCountsMock).not.toHaveBeenCalled();
    });

    it("returns 401 with a wrong admin key", async () => {
      const { status } = await callHandler({
        authorization: "Bearer not-the-admin-key",
      });
      expect(status).toBe(401);
      expect(collectUsageCountsMock).not.toHaveBeenCalled();
    });

    it("returns 403 on Langfuse Cloud (isAllowedOnLangfuseCloud defaults to false)", async () => {
      envMock.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION = "EU";
      const { status } = await callHandler();
      expect(status).toBe(403);
      expect(collectUsageCountsMock).not.toHaveBeenCalled();
    });

    it("returns 405 on POST", async () => {
      const { status } = await callHandler({ method: "POST" });
      expect(status).toBe(405);
      expect(collectUsageCountsMock).not.toHaveBeenCalled();
    });
  });

  describe("query validation", () => {
    it.each([
      ["start is not a datetime", { start: "yesterday" }],
      ["end is a date without a time", { end: "2026-09-29" }],
      [
        "start equals end",
        { start: "2026-09-01T00:00:00Z", end: "2026-09-01T00:00:00Z" },
      ],
      [
        "start is after end",
        { start: "2026-09-02T00:00:00Z", end: "2026-09-01T00:00:00Z" },
      ],
      [
        "start is after the default end (now)",
        { start: "2999-01-01T00:00:00Z" },
      ],
      [
        "start is repeated",
        { start: ["2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"] },
      ],
    ])("returns 400 when %s", async (_label, query) => {
      const { status, body } = await callHandler({ query });
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
      expect(collectUsageCountsMock).not.toHaveBeenCalled();
    });
  });

  describe("report", () => {
    it("returns every count plus billableUnits, version, clientId, window and generatedAt", async () => {
      const start = "2026-08-01T00:00:00.000Z";
      const end = "2026-09-01T00:00:00.000Z";
      const before = Date.now();

      const { status, body } = await callHandler({ query: { start, end } });

      expect(status).toBe(200);
      expect(collectUsageCountsMock).toHaveBeenCalledWith({
        start: new Date(start),
        end: new Date(end),
      });
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { name: "telemetry" },
        select: { state: true },
      });
      expect(body).toEqual({
        ...COUNTS,
        billableUnits: 10 + 40 + 3,
        langfuseVersion: VERSION,
        clientId: CLIENT_ID,
        licenseKeySuffix: "WXYZ",
        window: { start, end },
        generatedAt: expect.any(String),
      });
      expect(new Date(body.generatedAt).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    it("accepts datetimes with a timezone offset", async () => {
      const { status, body } = await callHandler({
        query: { start: "2026-08-01T02:00:00+02:00" },
      });
      expect(status).toBe(200);
      expect(body.window.start).toBe("2026-08-01T00:00:00.000Z");
    });

    it("defaults end to now and start to 30 days before end", async () => {
      const before = Date.now();
      const { status, body } = await callHandler();
      const after = Date.now();

      expect(status).toBe(200);
      const start = new Date(body.window.start).getTime();
      const end = new Date(body.window.end).getTime();
      expect(end).toBeGreaterThanOrEqual(before);
      expect(end).toBeLessThanOrEqual(after);
      expect(end - start).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("defaults start to 30 days before an explicit end", async () => {
      const { body } = await callHandler({
        query: { end: "2026-09-29T00:00:00.000Z" },
      });
      expect(body.window).toEqual({
        start: "2026-08-30T00:00:00.000Z",
        end: "2026-09-29T00:00:00.000Z",
      });
    });

    it("returns clientId null when the telemetry job has never run", async () => {
      findUniqueMock.mockResolvedValue(null);
      const { status, body } = await callHandler();
      expect(status).toBe(200);
      expect(body.clientId).toBeNull();
    });

    it("never includes the raw license key", async () => {
      const { body } = await callHandler();
      expect(JSON.stringify(body)).not.toContain(LICENSE_KEY);
      expect(body.licenseKeySuffix).toBe("WXYZ");
    });

    it("returns licenseKeySuffix null when no license key is set", async () => {
      envMock.LANGFUSE_EE_LICENSE_KEY = undefined;
      const { status, body } = await callHandler();
      expect(status).toBe(200);
      expect(body.licenseKeySuffix).toBeNull();
    });

    it("does not expose a license key too short to have a meaningful suffix", async () => {
      envMock.LANGFUSE_EE_LICENSE_KEY = "short";
      const { body } = await callHandler();
      expect(body.licenseKeySuffix).toBeNull();
      expect(JSON.stringify(body)).not.toContain("short");
    });

    it.each([
      ["set", "true"],
      ["unset", undefined],
    ])(
      "works with LANGFUSE_DISABLE_OUTBOUND %s and makes no outbound call",
      async (_label, value) => {
        envMock.LANGFUSE_DISABLE_OUTBOUND = value;
        const { status } = await callHandler();
        expect(status).toBe(200);
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it("returns 500 when the counts fail", async () => {
      collectUsageCountsMock.mockRejectedValue(new Error("clickhouse down"));
      const { status, body } = await callHandler();
      expect(status).toBe(500);
      expect(body).toEqual({ error: "Internal server error" });
    });
  });
});
