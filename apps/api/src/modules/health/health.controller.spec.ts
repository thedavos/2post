import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns ok status (parity with legacy GET /health/)", () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: "ok" });
  });
});
