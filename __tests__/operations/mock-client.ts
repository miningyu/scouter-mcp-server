import { vi } from "vitest";
import type { ScouterClient, ScouterObject } from "../../client/interface.js";

export const MOCK_OBJECTS: ScouterObject[] = [
  { objHash: 1, objName: "/app/tomcat1", objType: "tomcat", objFamily: "javaee", address: "10.0.0.1", alive: true },
  { objHash: 2, objName: "/app/tomcat2", objType: "tomcat", objFamily: "javaee", address: "10.0.0.2", alive: true },
  { objHash: 3, objName: "/dead/agent", objType: "tomcat", objFamily: "javaee", address: "10.0.0.3", alive: false },
];

/**
 * A ScouterClient that never touches the network. Any method not overridden resolves
 * to an empty array, which is what the real client returns for "nothing recorded".
 */
export function createMockClient(overrides: Partial<ScouterClient> = {}): ScouterClient {
  const base = {
    getObjects: vi.fn().mockResolvedValue(MOCK_OBJECTS),
    getRealtimeCounters: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", name: "TPS", value: 120 },
      { objHash: 2, objName: "/app/tomcat2", name: "TPS", value: 80 },
    ]),
    getActiveServiceStepCount: vi.fn().mockResolvedValue([]),
    getRealtimeAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
    getXLogData: vi.fn().mockResolvedValue([
      { txid: "tx1", elapsed: 5000, service: 123, error: 0, sqlCount: 3, sqlTime: 200 },
      { txid: "tx2", elapsed: 1000, service: 456, error: 789, sqlCount: 1, sqlTime: 50 },
    ]),
    lookupTexts: vi.fn().mockResolvedValue({
      "123": "/api/users", "456": "/api/orders", "789": "NullPointerException",
    }),
    controlThread: vi.fn().mockResolvedValue("OK"),
    removeInactiveAll: vi.fn().mockResolvedValue("removed"),
    removeInactiveServer: vi.fn().mockResolvedValue("removed"),
    setServerConfig: vi.fn().mockResolvedValue("saved"),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScouterClient;

  return new Proxy({ ...base, ...overrides } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return vi.fn().mockResolvedValue([]);
    },
  }) as unknown as ScouterClient;
}
