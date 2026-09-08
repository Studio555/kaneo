import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDatesEnabled } from "./instance-config.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDatesEnabled", () => {
  it("returns false when the instance reports dates disabled", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ datesEnabled: false }));
    expect(await fetchDatesEnabled("http://api.test")).toBe(false);
  });

  it("returns true when the instance reports dates enabled", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ datesEnabled: true }));
    expect(await fetchDatesEnabled("http://api.test")).toBe(true);
  });

  it("fails open when the field is absent", async () => {
    vi.stubGlobal("fetch", async () => Response.json({}));
    expect(await fetchDatesEnabled("http://api.test")).toBe(true);
  });

  it("fails open when the request throws", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await fetchDatesEnabled("http://api.test")).toBe(true);
  });

  it("fails open on a non-OK response", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await fetchDatesEnabled("http://api.test")).toBe(true);
  });
});
