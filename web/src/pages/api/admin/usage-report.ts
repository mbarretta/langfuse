import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { VERSION } from "@/src/constants";
import { env } from "@/src/env.mjs";
import { AdminApiAuthService } from "@/src/ee/features/admin-api/server";
import { collectUsageCounts } from "@/src/features/telemetry/usageCounts";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const UsageReportQuerySchema = z
  .object({
    start: z.iso.datetime({ offset: true }).optional(),
    end: z.iso.datetime({ offset: true }).optional(),
  })
  .transform(({ start, end }) => {
    const endDate = end ? new Date(end) : new Date();
    const startDate = start
      ? new Date(start)
      : new Date(endDate.getTime() - DEFAULT_WINDOW_MS);
    return { start: startDate, end: endDate };
  })
  .refine(({ start, end }) => start.getTime() < end.getTime(), {
    message: "start must be before end",
  });

/**
 * Last 4 characters of the license key, so a report can be matched to a
 * contract without exposing the key. Null when no key is set or the key is too
 * short for a suffix to be meaningfully shorter than the key itself.
 */
function licenseKeySuffix(): string | null {
  const key = env.LANGFUSE_EE_LICENSE_KEY;
  if (!key || key.length <= 8) return null;
  return key.slice(-4);
}

/**
 * GET /api/admin/usage-report
 *
 * Returns the usage counts the telemetry job would send, for the creation
 * window [start, end). Lets deployments that set LANGFUSE_DISABLE_OUTBOUND
 * produce the usage report on demand. Reads only the local databases.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // Verify admin API authentication, only allow on self-hosted (not on Langfuse Cloud)
    if (!AdminApiAuthService.handleAdminAuth(req, res)) {
      return;
    }

    const query = UsageReportQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: z.formatError(query.error),
      });
      return;
    }
    const { start, end } = query.data;

    const [counts, telemetryJob] = await Promise.all([
      collectUsageCounts({ start, end }),
      prisma.cronJobs.findUnique({
        where: { name: "telemetry" },
        select: { state: true },
      }),
    ]);

    res.status(200).json({
      window: { start: start.toISOString(), end: end.toISOString() },
      generatedAt: new Date().toISOString(),
      langfuseVersion: VERSION,
      clientId: telemetryJob?.state ?? null,
      licenseKeySuffix: licenseKeySuffix(),
      billableUnits: counts.traces + counts.observations + counts.scores,
      ...counts,
    });
  } catch (e) {
    logger.error("Failed to generate usage report", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
