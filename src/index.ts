/**
 * @accuren/fx — historical currency conversion with provenance.
 *
 * Tokenized stocks are priced in USD. Every tax office outside the US wants
 * the figure in local currency at the rate that applied *on the day of the
 * event* — not today's rate, and not an average. Converting at the wrong
 * rate does not shade a number slightly; it reports a gain you did not make.
 *
 * Every conversion here carries the rate, its source, and its date, so an
 * adviser or an auditor can retrace the arithmetic instead of trusting it.
 */
import { type Dec, dec, div, mul, round, toString } from "@accuren/multiplier";

export type { Dec };
// Re-exported so a caller can build amounts and print them without reaching
// past this package for its decimal type.
export { dec, toString };

export type Currency = string;

export type Money = {
  readonly amount: Dec;
  readonly currency: Currency;
};

export const money = (amount: string | Dec, currency: Currency): Money => ({
  amount: typeof amount === "string" ? dec(amount) : amount,
  currency,
});

/** One published rate: `base` → `quote`, as of `date`. */
export type Rate = {
  readonly base: Currency;
  readonly quote: Currency;
  /** Units of `quote` per one `base`. */
  readonly value: Dec;
  /** ISO date the rate was published for. */
  readonly date: string;
  /** Who published it. Mixing sources inside one filing is how reconciliations fail. */
  readonly source: string;
};

/**
 * What to do when an event falls on a day with no published rate — a weekend,
 * a public holiday. Tokens trade then; FX desks do not.
 *
 * There is no universally correct answer, which is exactly why this is
 * required rather than defaulted: jurisdictions specify their own, and the
 * choice has to be recorded with the figure.
 */
export type WeekendRule = "previous_published" | "next_published" | "error";

export type ConversionPolicy = {
  readonly weekendRule: WeekendRule;
  /** Decimal places for the converted amount. Minor units for most currencies; more for crypto. */
  readonly scale: number;
  /** Refuse a rate published more than this many days from the event date. */
  readonly maxDriftDays?: number;
};

export type Conversion = {
  readonly from: Money;
  readonly to: Money;
  readonly rate: Rate;
  /** Days between the event and the rate actually used. Zero on a normal weekday. */
  readonly rateDrift: number;
  readonly requestedDate: string;
};

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY);

/**
 * A set of published rates, indexed for lookup by date.
 *
 * Deliberately dumb: it does not fetch, interpolate, or invent. Feed it what
 * your jurisdiction publishes and it will tell you what it has.
 */
export class RateTable {
  readonly #rates = new Map<string, Rate[]>();

  constructor(rates: readonly Rate[] = []) {
    for (const rate of rates) this.add(rate);
  }

  #key(base: Currency, quote: Currency): string {
    return `${base.toUpperCase()}/${quote.toUpperCase()}`;
  }

  add(rate: Rate): this {
    const key = this.#key(rate.base, rate.quote);
    const list = this.#rates.get(key) ?? [];
    list.push(rate);
    list.sort((a, b) => a.date.localeCompare(b.date));
    this.#rates.set(key, list);
    return this;
  }

  /** Exactly what was published on that date, or null. No fallback, no guessing. */
  on(base: Currency, quote: Currency, date: string): Rate | null {
    const list = this.#rates.get(this.#key(base, quote)) ?? [];
    return list.find((r) => r.date === date) ?? null;
  }

  /** The last rate published on or before `date`. */
  before(base: Currency, quote: Currency, date: string): Rate | null {
    const list = this.#rates.get(this.#key(base, quote)) ?? [];
    let found: Rate | null = null;
    for (const rate of list) {
      if (rate.date <= date) found = rate;
      else break;
    }
    return found;
  }

  /** The first rate published on or after `date`. */
  after(base: Currency, quote: Currency, date: string): Rate | null {
    const list = this.#rates.get(this.#key(base, quote)) ?? [];
    return list.find((r) => r.date >= date) ?? null;
  }

  /** Resolve a rate under a weekend rule, or throw explaining what is missing. */
  resolve(base: Currency, quote: Currency, date: string, rule: WeekendRule): Rate {
    const exact = this.on(base, quote, date);
    if (exact) return exact;

    if (rule === "error") {
      throw new RangeError(`no ${base}/${quote} rate published for ${date}`);
    }

    const fallback =
      rule === "previous_published" ? this.before(base, quote, date) : this.after(base, quote, date);

    if (!fallback) {
      throw new RangeError(
        `no ${base}/${quote} rate ${rule === "previous_published" ? "on or before" : "on or after"} ${date}`,
      );
    }
    return fallback;
  }
}

/**
 * Convert an amount as of a date.
 *
 * Throws rather than falling back to a nearby rate silently: a figure whose
 * provenance you cannot state is one you cannot defend.
 */
export function convert(
  amount: Money,
  to: Currency,
  date: string,
  table: RateTable,
  policy: ConversionPolicy,
): Conversion {
  if (amount.currency.toUpperCase() === to.toUpperCase()) {
    return {
      from: amount,
      to: amount,
      rate: { base: amount.currency, quote: to, value: dec("1"), date, source: "identity" },
      rateDrift: 0,
      requestedDate: date,
    };
  }

  const rate = table.resolve(amount.currency, to, date, policy.weekendRule);
  const drift = daysBetween(date, rate.date);

  if (policy.maxDriftDays !== undefined && drift > policy.maxDriftDays) {
    throw new RangeError(
      `nearest ${amount.currency}/${to} rate is ${drift} days from ${date}, over the ${policy.maxDriftDays}-day limit`,
    );
  }

  return {
    from: amount,
    to: money(round(mul(amount.amount, rate.value), policy.scale), to),
    rate,
    rateDrift: drift,
    requestedDate: date,
  };
}

/** Invert a rate, for tables published in only one direction. */
export function invert(rate: Rate, scale = 10): Rate {
  return {
    base: rate.quote,
    quote: rate.base,
    value: div(dec("1"), rate.value, scale),
    date: rate.date,
    source: `${rate.source} (inverted)`,
  };
}

/**
 * The line an export writes: the amount, the rate, the source, and the date.
 * Provenance travelling with the number is the whole point.
 */
export function describe(conversion: Conversion): string {
  const { from, to, rate, rateDrift, requestedDate } = conversion;
  const drift =
    rateDrift === 0 ? "" : ` (rate from ${rate.date}, ${rateDrift} day${rateDrift === 1 ? "" : "s"} from ${requestedDate})`;
  return `${toString(from.amount)} ${from.currency} → ${toString(to.amount)} ${to.currency} at ${toString(rate.value)} [${rate.source}]${drift}`;
}
