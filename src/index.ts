import postgres from "postgres";
import Convert from "ansi-to-html";

interface Env {}

const STYLE_HTML = `<style>
code {
  font-family: "SFMono-Regular", "DejaVu Sans Mono", Monaco, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
}
</style>`;

const htmlResponse = (body: string): Response =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });

const jsonResponse = (data: any, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const textResponse = (msg: string, status = 200): Response =>
  new Response(msg, {
    status,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });

async function handleDb<T>(
  dbAction: () => Promise<T>,
  onSuccess: (result: T) => Response,
  notFoundMsg = "No data found",
): Promise<Response> {
  try {
    const result = await dbAction();
    if (!result || (Array.isArray(result) && result.length === 0)) {
      return textResponse(notFoundMsg, 404);
    }
    return onSuccess(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("Database error:", err);
      return textResponse("Database error: " + err.message, 500);
    }
    console.error("Unknown error:", err);
    return textResponse("Database error: Unknown error", 500);
  }
}

const cachedHtmlResponse = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (!res.ok) return res;
  const html = await res.text();
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};

async function handleRequest(
  request: Request,
  env: any,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Support HEAD method by treating it like GET and stripping body later
  const isHead = method === "HEAD";
  const effectiveMethod = isHead ? "GET" : method;

  const FRONTEND_PREFIX = env.FRONTEND_PREFIX;
  const LOG_PREFIX = env.LOG_PREFIX;

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
  });

  if (effectiveMethod === "GET" && pathname === "/") {
    return cachedHtmlResponse(`${FRONTEND_PREFIX}html/logs.html`);
  }

  if (effectiveMethod === "GET" && pathname === "/current/") {
    return cachedHtmlResponse(`${FRONTEND_PREFIX}html/current.html`);
  }

  if (effectiveMethod === "GET" && pathname.startsWith("/static/")) {
    const filePath = pathname.slice("/static/".length);
    const fileUrl = `${FRONTEND_PREFIX}static/${filePath}`;
    const res = await fetch(fileUrl);
    if (!res.ok) return res;

    const contentTypes: Record<string, string> = {
      ".css": "text/css; charset=UTF-8",
      ".js": "application/javascript; charset=UTF-8",
      ".html": "text/html; charset=UTF-8",
    };

    const ext = Object.keys(contentTypes).find((ext) => filePath.endsWith(ext));
    const contentType = ext
      ? contentTypes[ext]
      : (res.headers.get("content-type") ?? "application/octet-stream");

    return new Response(isHead ? null : res.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  if (effectiveMethod === "GET" && pathname.startsWith("/images/")) {
    const filePath = pathname.slice("/images/".length);
    const fileUrl = `${FRONTEND_PREFIX}images/${filePath}`;
    const res = await fetch(fileUrl);
    if (!res.ok) return res;

    const imageTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };
    const ext = Object.keys(imageTypes).find((ext) => filePath.endsWith(ext));
    const contentType = ext
      ? imageTypes[ext]
      : (res.headers.get("content-type") ?? "application/octet-stream");

    return new Response(isHead ? null : res.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  if (effectiveMethod === "GET" && pathname === "/imlonghao-api/status") {
    return handleDb(
      () => sql`SELECT * FROM lilac.batch ORDER BY id DESC LIMIT 1`,
      (result) => {
        const row = result[0];
        return jsonResponse({
          ts: new Date(row.ts).getTime(),
          event: row.event,
        });
      },
    );
  }

  if (effectiveMethod === "GET" && pathname === "/imlonghao-api/current") {
    return handleDb(
      () => sql`
        SELECT
          COALESCE(log.elapsed, -1) AS elapsed,
          c.updated_at,
          c.pkgbase,
          c.status,
          c.build_reasons::TEXT
        FROM lilac.pkgcurrent AS c
        LEFT JOIN LATERAL (
          SELECT elapsed FROM lilac.pkglog WHERE pkgbase = c.pkgbase ORDER BY ts DESC LIMIT 1
        ) AS log ON TRUE
      `,
      (result) => {
        const mapped = result.map((row: any) => ({
          updated_at: new Date(row.updated_at).getTime(),
          pkgbase: row.pkgbase,
          status: row.status,
          reasons: row.build_reasons,
          elapsed: row.elapsed,
        }));
        return jsonResponse(mapped);
      },
    );
  }

  if (effectiveMethod === "GET" && pathname === "/imlonghao-api/logs") {
    return handleDb(
      () => sql`
        SELECT
          ts,
          pkgbase,
          COALESCE(pkg_version, '') AS pkg_version,
          elapsed,
          result,
          COALESCE(maintainers #>> '{}', '[]') AS maintainers,
          COALESCE(
            CASE WHEN elapsed = 0 THEN 0 ELSE cputime * 100 / elapsed END,
            -1
          ) AS cpu,
          COALESCE(memory / 1073741824.0, -1) AS memory
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY pkgbase ORDER BY ts DESC) AS k
          FROM lilac.pkglog
        ) AS w
        WHERE k = 1
        ORDER BY ts DESC
      `,
      (result) => {
        const mapped = result.map((row: any) => ({
          ts: new Date(row.ts).getTime(),
          pkgbase: row.pkgbase,
          pkg_version: row.pkg_version,
          maintainer: row.maintainers,
          elapsed: row.elapsed,
          result: row.result,
          cpu: row.cpu,
          memory: parseFloat(row.memory),
        }));
        return jsonResponse(mapped);
      },
      "No logs found",
    );
  }

  const pkgMatch = pathname.match(/^\/imlonghao-api\/pkg\/([^\/]+)$/);
  if (effectiveMethod === "GET" && pkgMatch) {
    const name = decodeURIComponent(pkgMatch[1]);

    return handleDb(
      () => sql`
        SELECT
          ts,
          pkgbase,
          COALESCE(pkg_version, '') AS pkg_version,
          elapsed,
          result,
          COALESCE(maintainers #>> '{}', '[]') AS maintainers,
          COALESCE(
            CASE WHEN elapsed = 0 THEN 0 ELSE cputime * 100 / elapsed END,
            -1
          ) AS cpu,
          COALESCE(memory / 1073741824.0, -1) AS memory
        FROM lilac.pkglog
        WHERE pkgbase = ${name}
        ORDER BY id DESC
      `,
      (result) => {
        const mapped = result.map((row: any) => ({
          ts: new Date(row.ts).getTime(),
          pkgbase: row.pkgbase,
          pkg_version: row.pkg_version,
          maintainer: row.maintainers,
          elapsed: row.elapsed,
          result: row.result,
          cpu: row.cpu,
          memory: parseFloat(row.memory),
        }));
        return jsonResponse(mapped);
      },
      `No logs found for package ${name}`,
    );
  }

  const logMatch = pathname.match(
    /^\/imlonghao-api\/pkg\/([^\/]+)\/log\/(\d+)$/,
  );
  if (effectiveMethod === "GET" && logMatch) {
    const name = decodeURIComponent(logMatch[1]);
    const ts = Number(logMatch[2]);

    if (isNaN(ts)) return textResponse("Invalid timestamp", 400);

    const dt = new Date(ts * 1000);
    try {
      const result = await sql`
        SELECT logdir FROM lilac.batch
        WHERE ts < ${dt} AND event = 'start' AND logdir IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `;
      if (result.length === 0) {
        return textResponse("ts is too old", 400);
      }

      const logdir = result[0].logdir;
      const filename = `${logdir}/${name}.log`;
      const logRes = await fetch(LOG_PREFIX + filename);

      if (!logRes.ok) return textResponse("Log not found", 404);

      const contents = await logRes.text();
      const convert = new Convert();
      const converted = convert.toHtml(contents);
      const body = `${STYLE_HTML}<code>${converted}</code>`;

      return new Response(isHead ? null : body, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "public, max-age=600",
        },
      });
    } catch (err) {
      return textResponse("Log file error", 404);
    }
  }

  return textResponse("Not found", 404);
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
