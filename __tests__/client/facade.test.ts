import { describe, it, expect, afterEach, vi } from "vitest";
import { closeClient, createClient, describeConnection } from "../../client/index.js";
import { HttpClient } from "../../client/http.js";
import { TcpClient } from "../../client/tcp.js";
import type { ScouterClient } from "../../client/interface.js";

const ENV_KEYS = [
  "SCOUTER_API_URL", "SCOUTER_API_ID", "SCOUTER_API_PASSWORD",
  "SCOUTER_TCP_HOST", "SCOUTER_TCP_PORT", "SCOUTER_ENABLE_WRITE", "SCOUTER_MASK_PII",
] as const;
const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("createClient", () => {
  it("builds an HTTP client by default", () => {
    clearEnv();
    expect(createClient()).toBeInstanceOf(HttpClient);
  });

  it("builds a TCP client when SCOUTER_TCP_HOST is set", () => {
    clearEnv();
    process.env.SCOUTER_TCP_HOST = "scouter.internal";
    expect(createClient()).toBeInstanceOf(TcpClient);
  });

  it("builds an independent client each call", () => {
    clearEnv();
    expect(createClient()).not.toBe(createClient());
  });
});

describe("describeConnection", () => {
  it("reports HTTP mode with its endpoint", () => {
    clearEnv();
    process.env.SCOUTER_API_URL = "http://scouter.example:6180";
    expect(describeConnection()).toMatchObject({
      protocol: "http",
      endpoint: "http://scouter.example:6180",
      endpointConfigured: true,
    });
  });

  it("reports TCP mode as host:port", () => {
    clearEnv();
    process.env.SCOUTER_TCP_HOST = "scouter.internal";
    process.env.SCOUTER_TCP_PORT = "6101";
    expect(describeConnection()).toMatchObject({ protocol: "tcp", endpoint: "scouter.internal:6101" });
  });

  it("flags the default endpoint as not configured", () => {
    clearEnv();
    expect(describeConnection()).toMatchObject({
      endpoint: "http://localhost:6180",
      endpointConfigured: false,
    });
  });

  it("redacts credentials embedded in the URL", () => {
    clearEnv();
    process.env.SCOUTER_API_URL = "http://admin:hunter2@scouter.example:6180";
    const info = describeConnection();
    expect(info.endpoint).toBe("http://***@scouter.example:6180");
    expect(info.endpoint).not.toContain("hunter2");
  });

  it("reports whether a password is set without exposing it", () => {
    clearEnv();
    process.env.SCOUTER_API_PASSWORD = "hunter2";
    const info = describeConnection();
    expect(info.authConfigured).toBe(true);
    expect(JSON.stringify(info)).not.toContain("hunter2");
  });

  it("reports the write and PII flags", () => {
    clearEnv();
    expect(describeConnection()).toMatchObject({ writeEnabled: false, maskPii: true });
    process.env.SCOUTER_ENABLE_WRITE = "true";
    process.env.SCOUTER_MASK_PII = "false";
    expect(describeConnection()).toMatchObject({ writeEnabled: true, maskPii: false });
  });
});

describe("closeClient", () => {
  it("closes a client that supports it", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await closeClient({ close } as unknown as ScouterClient);
    expect(close).toHaveBeenCalledOnce();
  });

  it("tolerates a client without close()", async () => {
    await expect(closeClient({} as ScouterClient)).resolves.toBeUndefined();
  });

  it("never rethrows a failed close", async () => {
    const close = vi.fn().mockRejectedValue(new Error("socket already gone"));
    await expect(closeClient({ close } as unknown as ScouterClient)).resolves.toBeUndefined();
  });

  it("is a no-op on an HTTP client", async () => {
    clearEnv();
    await expect(closeClient(createClient())).resolves.toBeUndefined();
  });
});
