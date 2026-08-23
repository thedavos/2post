/**
 * Port of providers/meta_insights.py + shared Graph API plumbing used by the
 * Meta-backed providers (facebook, instagram, instagram_login, threads).
 */

export const GRAPH_BASE_URL = "https://graph.facebook.com/v25.0";
export const FACEBOOK_OAUTH_URL = "https://www.facebook.com/v25.0/dialog/oauth";

const PERMISSION_ERROR_CODES = new Set([10, 190, 200]);
const PERMISSION_ERROR_MARKERS = [
  "access token",
  "authorization",
  "authorized",
  "insufficient",
  "oauth",
  "permission",
  "permissions",
  "scope",
];

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly rawResponse: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** True for Meta auth/scope errors that should trigger reconnect handling. */
export function isMetaPermissionError(exc: MetaApiError): boolean {
  const error =
    exc.rawResponse && typeof exc.rawResponse === "object"
      ? ((exc.rawResponse as Record<string, unknown>)["error"] as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const code = error ? Number(error["code"]) : NaN;

  if (PERMISSION_ERROR_CODES.has(code)) return true;
  if (exc.statusCode === 403) return true;

  const message = [
    error?.["message"],
    error?.["type"],
    error?.["error_user_msg"],
    exc.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return PERMISSION_ERROR_MARKERS.some((marker) => message.includes(marker));
}

/** Port of parse_insights_response: latest value per metric, lifetime wins. */
export function parseInsightsResponse(data: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const periods: Record<string, string> = {};

  for (const entry of (data["data"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const name = String(entry["name"] ?? "");
    if (!name) continue;
    const period = String(entry["period"] ?? "");
    if (periods[name] === "lifetime" && period !== "lifetime") continue;

    let value: unknown;
    if ("total_value" in entry) {
      value =
        ((entry["total_value"] as Record<string, unknown> | undefined)?.["value"] as number) ?? 0;
    } else {
      value =
        ((entry["values"] as Array<Record<string, unknown>> | undefined)?.[0]?.["value"] as number) ??
        0;
    }

    if (!(name in values) || period === "lifetime") {
      values[name] = value;
      periods[name] = period;
    }
  }
  return values;
}

/**
 * Fetch Meta insights one metric at a time so one invalid metric cannot fail
 * all metrics. Permission errors propagate; others are collected per metric.
 */
export async function fetchInsightsSafe(
  graphGet: (
    url: string,
    accessToken: string,
    params?: Record<string, string>,
  ) => Promise<Record<string, unknown>>,
  options: {
    endpoint: string;
    accessToken: string;
    metrics: readonly string[];
    baseParams?: Record<string, string>;
    metricParams?: Record<string, Record<string, string>>;
  },
): Promise<{ values: Record<string, unknown>; errors: Record<string, string> }> {
  const { endpoint, accessToken, metrics, baseParams = {}, metricParams = {} } = options;

  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const metric of metrics) {
    const params = { ...baseParams, ...(metricParams[metric] ?? {}), metric };
    try {
      const response = await graphGet(endpoint, accessToken, params);
      Object.assign(values, parseInsightsResponse(response));
    } catch (exc) {
      if (exc instanceof MetaApiError && isMetaPermissionError(exc)) throw exc;
      errors[metric] = String(exc);
    }
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Graph request helpers
// ---------------------------------------------------------------------------

function extractGraphError(status: number, body: Record<string, unknown>): MetaApiError {
  const error = body["error"] as Record<string, unknown> | undefined;
  const message = String(error?.["message"] ?? `Graph API error HTTP ${status}`);
  return new MetaApiError(message, status, body);
}

export async function graphGet(
  url: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params ?? {});
  const response = await fetch(`${url}?${search.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || body["error"]) throw extractGraphError(response.status, body);
  return body;
}

export async function graphPost(
  url: string,
  accessToken: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || body["error"]) throw extractGraphError(response.status, body);
  return body;
}
