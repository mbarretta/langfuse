import { env } from "@/src/env.mjs";
import { logger } from "@langfuse/shared/src/server";
import { isEnterpriseLicenseAvailable } from "@langfuse/shared/src/server/ee/licenseCheck";

let hasWarnedMissingLicense = false;

/**
 * Whether this instance must make no outbound calls (usage telemetry, server
 * PostHog, update check). Requires LANGFUSE_DISABLE_OUTBOUND="true" on a
 * self-hosted deployment with an enterprise license key. The Cloud check comes
 * first because isEnterpriseLicenseAvailable() is true on Cloud without a key.
 */
export function isOutboundDisabled(): boolean {
  if (env.LANGFUSE_DISABLE_OUTBOUND !== "true") return false;
  if (env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION !== undefined) return false;

  if (!isEnterpriseLicenseAvailable()) {
    if (!hasWarnedMissingLicense) {
      hasWarnedMissingLicense = true;
      logger.warn(
        "LANGFUSE_DISABLE_OUTBOUND is set but has no effect: it requires an enterprise license key (LANGFUSE_EE_LICENSE_KEY starting with langfuse_ee_).",
      );
    }
    return false;
  }

  return true;
}
