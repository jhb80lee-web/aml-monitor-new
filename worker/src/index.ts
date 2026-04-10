// aml-monitor-new/worker/src/index.ts

export interface Env {
  AML_BUCKET: R2Bucket;
  CORS_ORIGIN: string;
  ADMIN_KEY: string;

  // (선택) 배포 버전 표시용 - 없어도 됨
  APP_VERSION?: string;
  GIT_SHA?: string;
}

const CRON_STATUS_KEY_OFAC = "cron/ofac-sdn/status.json";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // OPTIONS 프리플라이트 (CORS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    // ----------------------------------------------------
    // 0) ROOT — API 정보 (배포/심사용)
    // ----------------------------------------------------
    if (path === "/") {
      return json(
        {
          service: "AML Monitor API",
          status: "running",
          endpoints: [
            "/health",
            "/version",
            "/kofiu/vasp/latest",
            "/kofiu/restricted/latest",
            "/peps/cia/latest",
            "/ofac/sdn/latest",
            "/ofac/sdn/diff",
            "/ofac/sdn/history",
            "/ofac/history",
            "/un/sdn/latest",
            "/un/sdn/history",
            "/un/history",
            "/un/history/list",

            // cron debug
            "/internal/peps/cia/update (POST)",
            "/internal/ofac/sdn/cron-check (POST)",
            "/internal/ofac/sdn/cron-status (GET)",
          ],
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 1) HEALTH CHECK (Worker + R2 binding sanity)
    // ----------------------------------------------------
    if (path === "/health") {
      const startedAt = Date.now();

      const adminKeySet = !!env.ADMIN_KEY;
      const corsOriginSet = !!env.CORS_ORIGIN;

      let r2Ok = true;
      let r2Error: string | null = null;
      let r2LatencyMs: number | null = null;

      try {
        const t0 = Date.now();
        await env.AML_BUCKET.list({ limit: 1 });
        r2LatencyMs = Date.now() - t0;
      } catch (e: any) {
        r2Ok = false;
        r2Error = e?.message ? String(e.message) : "R2 check failed";
      }

      const ok = adminKeySet && corsOriginSet && r2Ok;

      return json(
        {
          status: ok ? "ok" : "degraded",
          worker: "orange-bread-2e13",
          time: new Date().toISOString(),
          checks: {
            adminKeySet,
            corsOriginSet,
            r2Ok,
            r2LatencyMs,
            ...(r2Error ? { r2Error } : {}),
          },
          latencyMs: Date.now() - startedAt,
        },
        ok ? 200 : 503,
        env
      );
    }

    // ----------------------------------------------------
    // 1-1) VERSION (build info)
    // ----------------------------------------------------
    if (path === "/version") {
      return json(
        {
          service: "AML Monitor API",
          worker: "orange-bread-2e13",
          version: env.APP_VERSION || "unknown",
          gitSha: env.GIT_SHA || "unknown",
          time: new Date().toISOString(),
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 2) KOFIU VASP — Latest Snapshot from R2
    // ----------------------------------------------------
    if (path === "/kofiu/vasp/latest") {
      const obj = await env.AML_BUCKET.get("kofiu/vasp/latest.json");
      if (!obj) return notFound("KOFIU VASP latest.json not found in R2", env);
      return json(await obj.json(), 200, env);
    }

    // ----------------------------------------------------
    // 2-1) KOFIU Restricted — Latest Snapshot from R2
    // ----------------------------------------------------
    if (path === "/kofiu/restricted/latest") {
      const obj = await env.AML_BUCKET.get("kofiu/restricted/latest.json");
      if (!obj) {
        return notFound("KOFIU restricted latest.json not found in R2", env);
      }
      return json(await obj.json(), 200, env);
    }

    // ----------------------------------------------------
    // 2-1A) CIA PEPs — Latest Snapshot from R2
    // ----------------------------------------------------
    if (path === "/peps/cia/latest") {
      const obj = await env.AML_BUCKET.get("peps/cia/latest.json");
      if (!obj) {
        return notFound("CIA PEP latest.json not found in R2", env);
      }
      return json(await obj.json(), 200, env);
    }

    // ----------------------------------------------------
    // 2-1B) CIA PEPs — Update Snapshot (POST)
    // ----------------------------------------------------
    if (path === "/internal/peps/cia/update" && request.method === "POST") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "invalid_json", message: "Request body must be JSON" },
          400,
          env
        );
      }

      if (!body || !Array.isArray(body.data)) {
        return json(
          { error: "invalid_payload", message: "`data` must be an array" },
          400,
          env
        );
      }

      if ((body.total ?? body.data.length) <= 0) {
        return json({ error: "empty_payload" }, 400, env);
      }

      const countries = Array.isArray(body.countries)
        ? body.countries
        : buildPepCountryMeta(body.data);

      const letters = Array.isArray(body.letters)
        ? body.letters
        : [...new Set(countries.map((country: any) => String(country?.letter || "").trim()).filter(Boolean))].sort();

      const payload = {
        source: body.source || "cia_world_leaders",
        updatedAt: body.updatedAt || new Date().toISOString(),
        total: body.total ?? body.data.length,
        letters,
        countries,
        data: body.data,
      };

      await env.AML_BUCKET.put(
        "peps/cia/latest.json",
        JSON.stringify(payload),
        { httpMetadata: { contentType: "application/json" } }
      );

      return json(
        {
          status: "ok",
          key: "peps/cia/latest.json",
          total: payload.total,
          countries: payload.countries.length,
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 2-2) KOFIU Restricted — Update Snapshot (POST)
    // 🔐 x-admin-key 헤더 필요
    // ----------------------------------------------------
    if (
      path === "/internal/kofiu/restricted/update" &&
      request.method === "POST"
    ) {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "invalid_json", message: "Request body must be JSON" },
          400,
          env
        );
      }

      if (!body || !Array.isArray(body.data)) {
        return json(
          { error: "invalid_payload", message: "`data` must be an array" },
          400,
          env
        );
      }

      if ((body.total ?? body.data.length) <= 0)
        return json({ error: "empty_payload" }, 400, env);

      const payload = {
        source: body.source || "kofiu_pdf",
        updatedAt: body.updatedAt || new Date().toISOString(),
        total: body.total ?? body.data.length,
        data: body.data,
      };

      await env.AML_BUCKET.put(
        "kofiu/restricted/latest.json",
        JSON.stringify(payload),
        { httpMetadata: { contentType: "application/json" } }
      );

      return json(
        {
          status: "ok",
          key: "kofiu/restricted/latest.json",
          total: payload.total,
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 2-3) KOFIU VASP — Update Snapshot (POST)
    // 🔐 x-admin-key 헤더 필요
    // ----------------------------------------------------
    if (path === "/internal/kofiu/vasp/update" && request.method === "POST") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "invalid_json", message: "Request body must be JSON" },
          400,
          env
        );
      }

      const normal = Array.isArray(body?.normal) ? body.normal : [];
      const data = Array.isArray(body?.data) ? body.data : normal;

      const total =
        typeof body?.total === "number" ? body.total : (data?.length ?? 0);

      if (total <= 0) return json({ error: "empty_payload" }, 400, env);

      const payload = {
        source: body.source || "kofiu_excel",
        updatedAt: body.updatedAt || new Date().toISOString(),
        total,
        normal,
        expired: Array.isArray(body?.expired) ? body.expired : [],
        expiredNote: body?.expiredNote || "",
        data,
      };

      await env.AML_BUCKET.put(
        "kofiu/vasp/latest.json",
        JSON.stringify(payload),
        { httpMetadata: { contentType: "application/json" } }
      );

      return json(
        {
          status: "ok",
          key: "kofiu/vasp/latest.json",
          total: payload.total,
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 3-0A) OFAC — Validate Admin Key (POST)
    // ----------------------------------------------------
    if (path === "/internal/ofac/sdn/validate" && request.method === "POST") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ ok: false, error: "unauthorized" }, 401, env);
      }

      return json(
        {
          ok: true,
          message: "admin key valid (no write performed)",
          time: new Date().toISOString(),
        },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // ✅ 3-0B) OFAC — Cron Check (POST)  (강제 실행)
    // ----------------------------------------------------
    if (path === "/internal/ofac/sdn/cron-check" && request.method === "POST") {
  const auth = request.headers.get("x-admin-key");
  if (auth !== env.ADMIN_KEY) return json({ error: "unauthorized" }, 401, env);

  // 쿼리로 scheduled 테스트 가능: ?as=scheduled
  const u = new URL(request.url);
  const as = u.searchParams.get("as");
  const reason = as === "scheduled" ? "scheduled" : "manual";

  const result = await runOfacCron(env, reason);
  return json(result, 200, env);
}

    // ----------------------------------------------------
    // ✅ 3-0C) OFAC — Cron Status (GET)  (마지막 실행 결과)
    // ----------------------------------------------------
    if (path === "/internal/ofac/sdn/cron-status" && request.method === "GET") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) return json({ error: "unauthorized" }, 401, env);

      const obj = await env.AML_BUCKET.get(CRON_STATUS_KEY_OFAC);
      if (!obj) return json({ ok: false, message: "no cron status yet" }, 200, env);

      try {
        return json(await obj.json(), 200, env);
      } catch {
        return json({ ok: false, message: "cron status parse failed" }, 200, env);
      }
    }

    // ----------------------------------------------------
    // 3-0) OFAC — Update Snapshot (POST)
    // ----------------------------------------------------
    if (path === "/internal/ofac/sdn/update" && request.method === "POST") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "invalid_json", message: "Request body must be JSON" },
          400,
          env
        );
      }

      if (!body || !Array.isArray(body.data)) {
        return json(
          { error: "invalid_payload", message: "`data` must be an array" },
          400,
          env
        );
      }

      if ((body.total ?? body.data.length) <= 0)
        return json({ error: "empty_payload" }, 400, env);

      const existingLatest = await env.AML_BUCKET.get("ofac/latest.json");
      if (existingLatest) {
        await env.AML_BUCKET.put("ofac/prev.json", await existingLatest.text(), {
          httpMetadata: { contentType: "application/json" },
        });
      }

      const payload = {
        source: body.source || "ofac_xml",
        updatedAt: body.updatedAt || new Date().toISOString(),
        total: body.total ?? body.data.length,
        data: body.data,
      };

      await env.AML_BUCKET.put("ofac/latest.json", JSON.stringify(payload), {
        httpMetadata: { contentType: "application/json" },
      });

      const prevForCount = existingLatest
        ? await existingLatest.json<any>().catch(() => null)
        : null;

      const { addedCount, removedCount } = computeAddedRemovedCounts(
        payload?.data || [],
        prevForCount?.data || []
      );

      const totalKorea = Array.isArray(payload?.data)
        ? payload.data.filter((x: any) => x?.isKorea).length
        : 0;

      const iso = new Date(payload.updatedAt || Date.now()).toISOString();
      const safeIso = iso.replace(/[:.]/g, "-");
      const snapKey = `ofac/history/${safeIso}.json`;

      await env.AML_BUCKET.put(
        snapKey,
        JSON.stringify({
          updatedAt: iso,
          total: payload.total,
          totalKorea,
          addedCount,
          removedCount,
        }),
        { httpMetadata: { contentType: "application/json" } }
      );

      return json(
        { status: "ok", key: "ofac/latest.json", total: payload.total },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 3) OFAC — Latest Snapshot from R2
    // ----------------------------------------------------
    if (path === "/ofac/sdn/latest") {
      const obj = await env.AML_BUCKET.get("ofac/latest.json");
      if (!obj) return notFound("OFAC latest.json not found in R2", env);
      return json(await obj.json(), 200, env);
    }

    // ----------------------------------------------------
    // 3-1) OFAC — History (앱용)
    // ----------------------------------------------------
    if (
      (path === "/ofac/sdn/history" || path === "/ofac/history") &&
      request.method === "GET"
    ) {
      const list = await env.AML_BUCKET.list({ prefix: "ofac/history/" });
      const keys = (list.objects || [])
        .map((o) => o.key)
        .sort()
        .reverse()
        .slice(0, 200);

      const snapshots: any[] = [];
      for (const key of keys) {
        const obj = await env.AML_BUCKET.get(key);
        if (!obj) continue;
        try {
          const j: any = await obj.json();
          snapshots.push({
            updatedAt: String(j?.updatedAt || ""),
            total: Number(j?.total || 0),
            totalKorea: Number(j?.totalKorea || 0),
            addedCount: Number(j?.addedCount || 0),
            removedCount: Number(j?.removedCount || 0),
          });
        } catch {
          continue;
        }
      }

      return json({ snapshots }, 200, env);
    }

    // ----------------------------------------------------
    // 4) OFAC — Diff (latest vs prev)
    // ----------------------------------------------------
    if (path === "/ofac/sdn/diff") {
      const latestObj = await env.AML_BUCKET.get("ofac/latest.json");
      const prevObj = await env.AML_BUCKET.get("ofac/prev.json");

      if (!latestObj || !prevObj) {
        return json(
          {
            error: "snapshot_missing",
            message: "Either latest.json or prev.json missing in R2",
          },
          400,
          env
        );
      }

      const latest = await latestObj.json<any>();
      const prev = await prevObj.json<any>();

      return json(computeOfacDiff(latest, prev), 200, env);
    }

    // ----------------------------------------------------
    // 4-0) UN — Update Snapshot (POST)
    // ----------------------------------------------------
    if (path === "/internal/un/sdn/update" && request.method === "POST") {
      const auth = request.headers.get("x-admin-key");
      if (auth !== env.ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "invalid_json", message: "Request body must be JSON" },
          400,
          env
        );
      }

      if (!body || !Array.isArray(body.data)) {
        return json(
          { error: "invalid_payload", message: "`data` must be an array" },
          400,
          env
        );
      }

      if ((body.total ?? body.data.length) <= 0)
        return json({ error: "empty_payload" }, 400, env);

      const existingLatest = await env.AML_BUCKET.get("un/latest.json");
      if (existingLatest) {
        await env.AML_BUCKET.put("un/prev.json", await existingLatest.text(), {
          httpMetadata: { contentType: "application/json" },
        });
      }

      const payload = {
        source: body.source || "un_xml",
        updatedAt: body.updatedAt || new Date().toISOString(),
        total: body.total ?? body.data.length,
        data: body.data,
      };

      await env.AML_BUCKET.put("un/latest.json", JSON.stringify(payload), {
        httpMetadata: { contentType: "application/json" },
      });

      const prevForCount = existingLatest
        ? await existingLatest.json<any>().catch(() => null)
        : null;

      const { addedCount, removedCount } = computeAddedRemovedCounts(
        payload?.data || [],
        prevForCount?.data || []
      );

      const totalKorea = Array.isArray(payload?.data)
        ? payload.data.filter((x: any) => x?.isKorea).length
        : 0;

      const iso = new Date(payload.updatedAt || Date.now()).toISOString();
      const safeIso = iso.replace(/[:.]/g, "-");
      const snapKey = `un/history/${safeIso}.json`;

      await env.AML_BUCKET.put(
        snapKey,
        JSON.stringify({
          updatedAt: iso,
          total: payload.total,
          totalKorea,
          addedCount,
          removedCount,
        }),
        { httpMetadata: { contentType: "application/json" } }
      );

      return json(
        { status: "ok", key: "un/latest.json", total: payload.total },
        200,
        env
      );
    }

    // ----------------------------------------------------
    // 5) UN — Latest Snapshot from R2
    // ----------------------------------------------------
    if (path === "/un/sdn/latest") {
      const obj = await env.AML_BUCKET.get("un/latest.json");
      if (!obj) return notFound("UN latest.json not found in R2", env);
      return json(await obj.json(), 200, env);
    }

    // ----------------------------------------------------
    // 5-1) UN — History (앱용)
    // ----------------------------------------------------
    if (
      (path === "/un/sdn/history" || path === "/un/history") &&
      request.method === "GET"
    ) {
      const list = await env.AML_BUCKET.list({ prefix: "un/history/" });
      const keys = (list.objects || [])
        .map((o) => o.key)
        .sort()
        .reverse()
        .slice(0, 200);

      const snapshots: any[] = [];
      for (const key of keys) {
        const obj = await env.AML_BUCKET.get(key);
        if (!obj) continue;
        try {
          const j: any = await obj.json();
          snapshots.push({
            updatedAt: String(j?.updatedAt || ""),
            total: Number(j?.total || 0),
            totalKorea: Number(j?.totalKorea || 0),
            addedCount: Number(j?.addedCount || 0),
            removedCount: Number(j?.removedCount || 0),
          });
        } catch {
          continue;
        }
      }

      return json({ snapshots }, 200, env);
    }

    // ----------------------------------------------------
    // 6) UN — History List
    // ----------------------------------------------------
    if (path === "/un/history/list") {
      const list = await env.AML_BUCKET.list({ prefix: "un/history/" });
      const items = list.objects.map((o) => ({
        key: o.key,
        uploaded: o.uploaded,
      }));
      return json(items, 200, env);
    }

    return notFound("Unknown route: " + path, env);
  },

  // ----------------------------------------------------
  // ✅ Cron Trigger Handler (핵심: 이게 없어서 에러 났던 부분)
  // ----------------------------------------------------
      // ----------------------------------------------------
  // ✅ Cron Trigger Handler (최신 타입: ScheduledController)
  // ----------------------------------------------------
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const t = new Date().toISOString();
        console.log(`[CRON] fired @ ${t} (scheduledTime=${controller?.scheduledTime ?? "?"}, cron=${controller?.cron ?? "?"})`);
        await runOfacCron(env, "scheduled");
      })()
    );
  },
} satisfies ExportedHandler<Env>;

/* ======================================================
   Helper Functions
====================================================== */

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  };
}

function json(data: any, status = 200, env?: Env): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  headers["Access-Control-Allow-Origin"] = env?.CORS_ORIGIN || "*";

  return new Response(JSON.stringify(data), { status, headers });
}

function notFound(msg: string, env: Env): Response {
  return json({ error: "not_found", message: msg }, 404, env);
}

/* ======================================================
   Cron Logic (OFAC 상태 저장용)
====================================================== */
async function runOfacCron(env: Env, reason: "scheduled" | "manual") {
  const ranAt = new Date().toISOString();

  const latestMeta = await getSnapshotMeta(env, "ofac/latest.json");
  const prevMeta = await getSnapshotMeta(env, "ofac/prev.json");

  const result = {
    ok: true,
    reason,
    ranAt,
    ofac: {
      latest: latestMeta,
      prev: prevMeta,
    },
  };

  await env.AML_BUCKET.put(CRON_STATUS_KEY_OFAC, JSON.stringify(result), {
    httpMetadata: { contentType: "application/json" },
  });

  console.log(`[CRON][OFAC] status saved -> ${CRON_STATUS_KEY_OFAC}`);
  return result;
}

async function getSnapshotMeta(env: Env, key: string) {
  const obj = await env.AML_BUCKET.get(key);
  if (!obj) return { key, exists: false };

  try {
    const j: any = await obj.json();
    const updatedAt = typeof j?.updatedAt === "string" ? j.updatedAt : null;
    const total = typeof j?.total === "number" ? j.total : null;

    const ageMinutes =
      updatedAt && !Number.isNaN(Date.parse(updatedAt))
        ? Math.floor((Date.now() - Date.parse(updatedAt)) / 60000)
        : null;

    return { key, exists: true, updatedAt, total, ageMinutes };
  } catch {
    return { key, exists: true, parseError: true };
  }
}

/* ======================================================
   Added/Removed count helper (OFAC/UN 공용)
====================================================== */
function computeAddedRemovedCounts(latestData: any[], prevData: any[]) {
  const latestMap = new Map((latestData || []).map((p: any) => [p?.uid, p]));
  const prevMap = new Map((prevData || []).map((p: any) => [p?.uid, p]));

  let addedCount = 0;
  let removedCount = 0;

  for (const uid of latestMap.keys()) {
    if (!prevMap.has(uid)) addedCount++;
  }
  for (const uid of prevMap.keys()) {
    if (!latestMap.has(uid)) removedCount++;
  }

  return { addedCount, removedCount };
}

/* ======================================================
   OFAC Diff Logic
====================================================== */
function computeOfacDiff(latest: any, prev: any) {
  const latestMap = new Map(latest.data.map((p: any) => [p.uid, p]));
  const prevMap = new Map(prev.data.map((p: any) => [p.uid, p]));

  const added: any[] = [];
  const removed: any[] = [];

  for (const [uid, person] of latestMap) {
    if (!prevMap.has(uid)) added.push(person);
  }

  for (const [uid, person] of prevMap) {
    if (!latestMap.has(uid)) removed.push(person);
  }

  return {
    updatedAt: new Date().toISOString(),
    currentTotal: latest.total,
    previousTotal: prev.total,
    addedCount: added.length,
    removedCount: removed.length,
    added,
    removed,
  };
}

function buildPepCountryMeta(data: any[]) {
  const counts = new Map<string, { code: string; name: string; letter: string; count: number }>();

  for (const row of data || []) {
    const code = String(row?.countryCode || "").trim().toUpperCase();
    const name = String(row?.country || "").trim();
    if (!code || !name) continue;

    const letterMatch = name.toUpperCase().match(/[A-Z]/);
    const letter = letterMatch ? letterMatch[0] : "#";
    const existing = counts.get(code);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(code, {
      code,
      name,
      letter,
      count: 1,
    });
  }

  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}
