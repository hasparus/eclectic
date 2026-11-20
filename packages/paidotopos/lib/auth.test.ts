import { expect, test } from "bun:test";
import { createSession, validSession, safeNext } from "./auth";
test("signed sessions reject tampering and missing configuration", async () => {
  const secret = "test-secret-with-at-least-32-characters";
  const session = await createSession(secret);
  expect(await validSession(session, secret)).toBe(true);
  expect(await validSession(session + "x", secret)).toBe(false);
  expect(await validSession(session, undefined)).toBe(false);
  expect(await validSession("0.invalid", secret)).toBe(false);
});
test("return paths cannot redirect off-site", () => {
  expect(safeNext("//evil.test")).toBe("/");
  expect(safeNext("/\\evil.test")).toBe("/");
  expect(safeNext("/prototypes/orbit-study")).toBe("/prototypes/orbit-study");
});
