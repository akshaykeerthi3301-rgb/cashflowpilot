import { expect, test } from "vitest";
import { query } from "@/db";

test("db answers", async () => {
  expect(await query("select 1 as x")).toEqual([{ x: 1 }]);
});
