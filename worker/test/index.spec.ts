import { describe, expect, it } from "vitest";
import worker from "../src/index";

function createEnv(overrides?: Partial<any>) {
  return {
    AML_BUCKET: {
      list: async () => ({ objects: [] }),
      get: async () => null,
      put: async () => undefined,
    },
    CORS_ORIGIN: "*",
    ADMIN_KEY: "test-admin-key",
    APP_VERSION: "test-version",
    GIT_SHA: "test-sha",
    ...overrides,
  };
}

describe("AML Monitor worker", () => {
  it("returns API metadata at the root endpoint", async () => {
    const request = new Request("https://example.com/");
    const response = await worker.fetch(request, createEnv() as any);

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      service: string;
      status: string;
      endpoints: string[];
    };

    expect(json.service).toBe("AML Monitor API");
    expect(json.status).toBe("running");
    expect(json.endpoints).toContain("/health");
    expect(json.endpoints).toContain("/kofiu/vasp/latest");
  });

  it("returns build metadata from the version endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/version"),
      createEnv() as any
    );

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      service: string;
      worker: string;
      version: string;
      gitSha: string;
    };

    expect(json.service).toBe("AML Monitor API");
    expect(json.worker).toBe("orange-bread-2e13");
    expect(typeof json.version).toBe("string");
    expect(typeof json.gitSha).toBe("string");
  });

  it("reports a healthy status when bindings are available", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      createEnv() as any
    );

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      status: string;
      checks: {
        adminKeySet: boolean;
        corsOriginSet: boolean;
        r2Ok: boolean;
      };
    };

    expect(json.status).toBe("ok");
    expect(json.checks.adminKeySet).toBe(true);
    expect(json.checks.corsOriginSet).toBe(true);
    expect(json.checks.r2Ok).toBe(true);
  });
});
