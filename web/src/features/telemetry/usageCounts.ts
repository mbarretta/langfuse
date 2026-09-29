import { prisma } from "@langfuse/shared/src/db";
import {
  getDatasetRunItemCountsByProjectInCreationInterval,
  getObservationCountsByProjectInCreationInterval,
  getScoreCountsByProjectInCreationInterval,
  getTraceCountsByProjectInCreationInterval,
} from "@langfuse/shared/src/server";

export type UsageCounts = {
  totalProjects: number;
  traces: number;
  scores: number;
  observations: number;
  datasets: number;
  datasetItems: number;
  datasetRuns: number;
  datasetRunItems: number;
  assistantRuns: number;
  userDomains: Array<{ domain: string; userCount: number }>;
};

const sumCounts = (rows: Array<{ count: number }>) =>
  rows.reduce((acc, curr) => acc + curr.count, 0);

/**
 * Instance-wide usage counts for the creation interval [start, end), as sent
 * by the usage telemetry job. A null start counts from the beginning: the
 * ClickHouse counts use the epoch, the Prisma counts omit the lower bound.
 * totalProjects is a current total, not an interval count.
 */
export async function collectUsageCounts({
  start,
  end,
}: {
  start: Date | null;
  end: Date;
}): Promise<UsageCounts> {
  // Count projects
  const totalProjects = await prisma.project.count({
    where: {
      deletedAt: null,
    },
  });

  // Count traces
  const traces = sumCounts(
    await getTraceCountsByProjectInCreationInterval({
      start: start ?? new Date(0),
      end,
    }),
  );

  // Count scores
  const scores = sumCounts(
    await getScoreCountsByProjectInCreationInterval({
      start: start ?? new Date(0),
      end,
    }),
  );

  // Count observations
  const observations = sumCounts(
    await getObservationCountsByProjectInCreationInterval({
      start: start ?? new Date(0),
      end,
    }),
  );

  // Count datasets
  const datasets = await prisma.dataset.count({
    where: {
      createdAt: {
        gte: start?.toISOString(),
        lt: end.toISOString(),
      },
    },
  });

  // Count dataset items
  const datasetItems = await prisma.datasetItem.count({
    where: {
      createdAt: {
        gte: start?.toISOString(),
        lt: end.toISOString(),
      },
    },
  });

  // Count dataset runs
  const datasetRuns = await prisma.datasetRuns.count({
    where: {
      createdAt: {
        gte: start?.toISOString(),
        lt: end.toISOString(),
      },
    },
  });

  // Count dataset run items
  const datasetRunItems = sumCounts(
    await getDatasetRunItemCountsByProjectInCreationInterval({
      start: start ?? new Date(0),
      end,
    }),
  );

  // Count Langfuse Assistant runs. Counted unconditionally: zero on an
  // instance that never enabled the Assistant is itself the answer.
  const assistantRuns = await prisma.inAppAgentRun.count({
    where: {
      createdAt: {
        gte: start?.toISOString(),
        lt: end.toISOString(),
      },
    },
  });

  // Domains (no PII)
  const userDomains = await prisma.$queryRaw<
    Array<{ domain: string; userCount: number }>
  >`
    SELECT
      substring(email FROM position('@' in email) + 1) as domain,
      count(id)::int as "userCount"
    FROM users
    WHERE email ILIKE '%@%'
    GROUP BY 1
    ORDER BY count(id) desc
    LIMIT 30
  `;

  return {
    totalProjects,
    traces,
    scores,
    observations,
    datasets,
    datasetItems,
    datasetRuns,
    datasetRunItems,
    assistantRuns,
    userDomains,
  };
}
