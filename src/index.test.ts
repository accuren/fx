import assert from "node:assert/strict";
import { test } from "node:test";
import { RateTable, convert, describe as line, dec, invert, money, toString, type Rate } from "./index.ts";

const rate = (date: string, value: string): Rate => ({
  base: "USD",
  quote: "IDR",
  value: dec(value),
  date,
  source: "bank_indonesia_middle_rate",
});

// Friday, then a gap over the weekend, then Monday.
const table = new RateTable([
  rate("2026-08-14", "16103"),
  rate("2026-08-17", "16220"),
  rate("2026-01-18", "15842"),
]);

const policy = { weekendRule: "previous_published", scale: 0 } as const;

test("converts at the rate published on the day of the event", () => {
  const c = convert(money("61.40", "USD"), "IDR", "2026-08-14", table, policy);
  assert.equal(toString(c.to.amount), "988724");
  assert.equal(c.rateDrift, 0);
  assert.equal(c.rate.source, "bank_indonesia_middle_rate");
});

test("the rate travels with the figure", () => {
  const c = convert(money("61.40", "USD"), "IDR", "2026-08-14", table, policy);
  assert.match(line(c), /61\.40 USD → 988724 IDR at 16103 \[bank_indonesia_middle_rate\]/);
});

test("today's rate is not the same number as the trade-date rate", () => {
  const january = convert(money("100", "USD"), "IDR", "2026-01-18", table, policy);
  const august = convert(money("100", "USD"), "IDR", "2026-08-14", table, policy);
  assert.notEqual(toString(january.to.amount), toString(august.to.amount));
  assert.equal(toString(january.to.amount), "1584200");
  assert.equal(toString(august.to.amount), "1610300");
});

test("a weekend falls back to the previous published rate, and says how far", () => {
  const c = convert(money("100", "USD"), "IDR", "2026-08-16", table, policy);
  assert.equal(c.rate.date, "2026-08-14");
  assert.equal(c.rateDrift, 2);
  assert.match(line(c), /2 days from 2026-08-16/);
});

test("the next-published rule reaches forward instead", () => {
  const c = convert(money("100", "USD"), "IDR", "2026-08-16", table, {
    weekendRule: "next_published",
    scale: 0,
  });
  assert.equal(c.rate.date, "2026-08-17");
  assert.equal(c.rateDrift, 1);
});

test("the error rule refuses to invent a rate", () => {
  assert.throws(
    () => convert(money("100", "USD"), "IDR", "2026-08-16", table, { weekendRule: "error", scale: 0 }),
    /no USD\/IDR rate published for 2026-08-16/,
  );
});

test("a rate too far from the event is refused rather than used quietly", () => {
  assert.throws(
    () =>
      convert(money("100", "USD"), "IDR", "2026-08-16", table, {
        weekendRule: "previous_published",
        scale: 0,
        maxDriftDays: 1,
      }),
    /over the 1-day limit/,
  );
});

test("an unknown pair fails loudly", () => {
  assert.throws(() => convert(money("100", "USD"), "EUR", "2026-08-14", table, policy), /no USD\/EUR rate/);
});

test("converting to the same currency is the identity, not a lookup", () => {
  const c = convert(money("100", "USD"), "usd", "1970-01-01", new RateTable(), policy);
  assert.equal(toString(c.to.amount), "100");
  assert.equal(c.rate.source, "identity");
});

test("lookups are exact, with no implicit fallback", () => {
  assert.equal(table.on("USD", "IDR", "2026-08-16"), null);
  assert.equal(table.before("USD", "IDR", "2026-08-16")?.date, "2026-08-14");
  assert.equal(table.after("USD", "IDR", "2026-08-16")?.date, "2026-08-17");
  assert.equal(table.before("USD", "IDR", "2020-01-01"), null);
});

test("inverting a rate keeps its provenance visible", () => {
  const inverted = invert(rate("2026-08-14", "16103"));
  assert.equal(inverted.base, "IDR");
  assert.equal(inverted.quote, "USD");
  assert.match(inverted.source, /inverted/);
  assert.equal(toString(inverted.value), "0.0000621002");
});

test("currency codes are matched case-insensitively", () => {
  const c = convert(money("100", "usd"), "idr", "2026-08-14", table, policy);
  assert.equal(toString(c.to.amount), "1610300");
});
