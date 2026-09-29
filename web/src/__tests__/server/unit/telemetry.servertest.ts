import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Usage telemetry job: the LANGFUSE_DISABLE_OUTBOUND gate and the
 * collectUsageCounts() extraction. isOutboundDisabled() is mocked (its own
 * license logic is covered by isOutboundDisabled.servertest.ts), as are the
 * prisma client, the ClickHouse count queries and ServerPosthog, so no case
 * touches a database or the network.
 */

const {
  envMock,
  isOutboundDisabledMock,
  prismaMock,
  countMocks,
  posthogCtor,
  captureMock,
  shutdownMock,
} = vi.hoisted(() => {
  const captureMock = vi.fn();
  const shutdownMock = vi.fn(async () => {});
  return {
    envMock: {} as Record<string, unknown>,
    isOutboundDisabledMock: vi.fn(() => false),
    prismaMock: {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(async () => 0),
      $transaction: vi.fn(),
      cronJobs: { update: vi.fn(async () => ({})) },
      project: { count: vi.fn(async () => 0) },
      dataset: { count: vi.fn(async () => 0) },
      datasetItem: { count: vi.fn(async () => 0) },
      datasetRuns: { count: vi.fn(async () => 0) },
      inAppAgentRun: { count: vi.fn(async () => 0) },
    },
    countMocks: {
      getTraceCountsByProjectInCreationInterval: vi.fn(),
      getScoreCountsByProjectInCreationInterval: vi.fn(),
      getObservationCountsByProjectInCreationInterval: vi.fn(),
      getDatasetRunItemCountsByProjectInCreationInterval: vi.fn(),
    },
    posthogCtor: vi.fn(),
    captureMock,
    shutdownMock,
  };
});

vi.mock("@/src/env.mjs", async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> };
  Object.assign(envMock, actual.env);
  return { env: envMock };
});

vi.mock("@/src/features/outbound/isOutboundDisabled", () => ({
  isOutboundDisabled: isOutboundDisabledMock,
}));

// Partial mock: keep Prisma.raw for the scheduler's interval fragments.
vi.mock("@langfuse/shared/src/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});

vi.mock("@langfuse/shared/src/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...countMocks };
});

vi.mock("@/src/features/posthog-analytics/ServerPosthog", () => ({
  ServerPosthog: class {
    constructor() {
      posthogCtor();
    }
    capture = captureMock;
    shutdown = shutdownMock;
  },
}));

import { telemetry } from "@/src/features/telemetry";
import { collectUsageCounts } from "@/src/features/telemetry/usageCounts";
import { VERSION } from "@/src/constants";

const JOB_STARTED_AT = new Date("2026-09-29T12:00:00.000Z");
const LAST_RUN = new Date("2026-09-29T00:00:00.000Z");
const DOMAINS = [
  { domain: "example.com", userCount: 3 },
  { domain: "example.org", userCount: 1 },
];

const sqlText = (strings: TemplateStringsArray | string[]) =>
  Array.from(strings).join("?");

/** Scheduler says the job is due; counting returns fixed, distinct values. */
const mockDueJobAndCounts = () => {
  prismaMock.$queryRaw.mockImplementation(async (strings: string[]) =>
    sqlText(strings).includes("cron_jobs") ? [{ status: true }] : DOMAINS,
  );
  prismaMock.$transaction.mockResolvedValue([
    0,
    [
      {
        name: "telemetry",
        last_run: LAST_RUN,
        job_started_at: JOB_STARTED_AT,
        state: "client-1",
      },
    ],
  ]);
  prismaMock.project.count.mockResolvedValue(2);
  countMocks.getTraceCountsByProjectInCreationInterval.mockResolvedValue([
    { projectId: "p1", count: 10 },
    { projectId: "p2", count: 5 },
  ]);
  countMocks.getScoreCountsByProjectInCreationInterval.mockResolvedValue([
    { projectId: "p1", count: 4 },
  ]);
  countMocks.getObservationCountsByProjectInCreationInterval.mockResolvedValue([
    { projectId: "p1", count: 20 },
    { projectId: "p2", count: 7 },
  ]);
  countMocks.getDatasetRunItemCountsByProjectInCreationInterval.mockResolvedValue(
    [{ projectId: "p1", count: 6 }],
  );
  prismaMock.dataset.count.mockResolvedValue(3);
  prismaMock.datasetItem.count.mockResolvedValue(8);
  prismaMock.datasetRuns.count.mockResolvedValue(1);
  prismaMock.inAppAgentRun.count.mockResolvedValue(9);
};

const allPrismaFns = () => [
  prismaMock.$queryRaw,
  prismaMock.$executeRaw,
  prismaMock.$transaction,
  prismaMock.cronJobs.update,
  prismaMock.project.count,
  prismaMock.dataset.count,
  prismaMock.datasetItem.count,
  prismaMock.datasetRuns.count,
  prismaMock.inAppAgentRun.count,
];

describe("telemetry()", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", undefined);
    envMock.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION = undefined;
    envMock.TELEMETRY_ENABLED = "true";
    envMock.LANGFUSE_EE_LICENSE_KEY = undefined;
    isOutboundDisabledMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("makes no prisma or ServerPosthog calls when outbound is disabled", async () => {
    // The EE exception would otherwise run the job despite TELEMETRY_ENABLED
    envMock.LANGFUSE_EE_LICENSE_KEY = "langfuse_ee_test_key";
    envMock.TELEMETRY_ENABLED = "false";
    isOutboundDisabledMock.mockReturnValue(true);
    mockDueJobAndCounts();

    await telemetry();

    expect(isOutboundDisabledMock).toHaveBeenCalled();
    for (const fn of allPrismaFns()) expect(fn).not.toHaveBeenCalled();
    for (const fn of Object.values(countMocks))
      expect(fn).not.toHaveBeenCalled();
    expect(posthogCtor).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("still runs the scheduler when outbound is not disabled", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ status: false }]);

    await telemetry();

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlText(prismaMock.$queryRaw.mock.calls[0]![0])).toContain(
      "cron_jobs",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(posthogCtor).not.toHaveBeenCalled();
  });

  it("keeps the EE exception to TELEMETRY_ENABLED=false when outbound is not disabled", async () => {
    envMock.LANGFUSE_EE_LICENSE_KEY = "langfuse_ee_test_key";
    envMock.TELEMETRY_ENABLED = "false";
    prismaMock.$queryRaw.mockResolvedValue([{ status: false }]);

    await telemetry();

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("sends the collected counts to PostHog in the unchanged payload shape", async () => {
    mockDueJobAndCounts();

    await telemetry();

    expect(posthogCtor).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "docker:client-1",
      event: "telemetry",
      properties: {
        langfuseVersion: VERSION,
        userDomains: DOMAINS,
        totalProjects: 2,
        traces: 15,
        scores: 4,
        observations: 27,
        datasets: 3,
        datasetItems: 8,
        datasetRuns: 1,
        datasetRunItems: 6,
        assistantRuns: 9,
        startTimeframe: LAST_RUN.toISOString(),
        endTimeframe: JOB_STARTED_AT.toISOString(),
        eeLicenseKey: undefined,
        langfuseCloudRegion: undefined,
        $set: {
          environment: "production",
          userDomains: DOMAINS,
          docker: true,
          langfuseVersion: VERSION,
        },
      },
    });
    expect(Object.keys(captureMock.mock.calls[0]![0].properties)).toEqual([
      "langfuseVersion",
      "userDomains",
      "totalProjects",
      "traces",
      "scores",
      "observations",
      "datasets",
      "datasetItems",
      "datasetRuns",
      "datasetRunItems",
      "assistantRuns",
      "startTimeframe",
      "endTimeframe",
      "eeLicenseKey",
      "langfuseCloudRegion",
      "$set",
    ]);
    expect(shutdownMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.cronJobs.update).toHaveBeenCalledWith({
      where: { name: "telemetry" },
      data: { lastRun: JOB_STARTED_AT, state: "client-1", jobStartedAt: null },
    });
  });
});

describe("collectUsageCounts()", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const clickhouseFns = () => Object.values(countMocks);
  const intervalPrismaFns = () => [
    prismaMock.dataset.count,
    prismaMock.datasetItem.count,
    prismaMock.datasetRuns.count,
    prismaMock.inAppAgentRun.count,
  ];

  it("returns the summed counts and domains", async () => {
    mockDueJobAndCounts();

    const counts = await collectUsageCounts({
      start: LAST_RUN,
      end: JOB_STARTED_AT,
    });

    expect(counts).toEqual({
      totalProjects: 2,
      traces: 15,
      scores: 4,
      observations: 27,
      datasets: 3,
      datasetItems: 8,
      datasetRuns: 1,
      datasetRunItems: 6,
      assistantRuns: 9,
      userDomains: DOMAINS,
    });
    expect(prismaMock.project.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
    for (const fn of clickhouseFns())
      expect(fn).toHaveBeenCalledWith({ start: LAST_RUN, end: JOB_STARTED_AT });
    for (const fn of intervalPrismaFns())
      expect(fn).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: LAST_RUN.toISOString(),
            lt: JOB_STARTED_AT.toISOString(),
          },
        },
      });
  });

  it("counts from the epoch in ClickHouse and without a lower bound in Prisma when start is null", async () => {
    mockDueJobAndCounts();

    await collectUsageCounts({ start: null, end: JOB_STARTED_AT });

    for (const fn of clickhouseFns())
      expect(fn).toHaveBeenCalledWith({
        start: new Date(0),
        end: JOB_STARTED_AT,
      });
    for (const fn of intervalPrismaFns())
      expect(fn).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: undefined, lt: JOB_STARTED_AT.toISOString() },
        },
      });
  });
});
