# Telemetry service for Docker deployments

By default, Langfuse automatically reports basic usage statistics to a centralized server (PostHog).

This helps us to:

1. Understand how Langfuse is used and improve the most relevant features.
2. Track overall usage for internal and external (e.g. fundraising) reporting.

The telemetry does not include raw traces, prompts, observations, scores, or dataset contents. We document the exact fields that are collected, where they are sent, and the implementation reference in our [telemetry docs](https://langfuse.com/self-hosting/security/telemetry).

For Langfuse OSS, you can opt out by setting `TELEMETRY_ENABLED=false`.

When a license key (`LANGFUSE_EE_LICENSE_KEY`) is set, `TELEMETRY_ENABLED=false` does not stop this job, because usage reporting is part of the license terms. Air-gapped enterprise deployments can instead set `LANGFUSE_DISABLE_OUTBOUND=true`, which stops three outbound paths: this job, server-side PostHog, and the update check. The flag only takes effect when `LANGFUSE_EE_LICENSE_KEY` holds an enterprise (`langfuse_ee_`) key; without one it is ignored and a warning is logged. Deployments that disable outbound calls report usage by sending the same counts this job collects, generated on demand from the admin API (`GET /api/admin/usage-report`, authenticated with `ADMIN_API_KEY`).

The flag does not affect features the operator configures: the Langfuse Assistant's docs MCP call (`https://langfuse.com/api/mcp`), browser PostHog when `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are set at build time, and the PostHog, Mixpanel, Slack, and blob-storage integrations. In an air-gapped deployment, keep the Assistant disabled (its MCP URL is fixed), and leave the rest off or point them at internal hosts.
