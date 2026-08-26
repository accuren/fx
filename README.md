# @accuren/fx

Historical currency conversion that carries its provenance.

Tokenized stocks are priced in USD. Every tax office outside the US wants the
figure in local currency at the rate that applied *on the day of the event* —
not today's, and not an average. Converting at the wrong rate does not shade a
number slightly; it reports a gain you did not make.

```ts
import { RateTable, convert, money, describe, dec } from "@accuren/fx";

const table = new RateTable([
  { base: "USD", quote: "IDR", value: dec("16103"), date: "2026-08-14", source: "bank_indonesia_middle_rate" },
]);

const c = convert(money("61.40", "USD"), "IDR", "2026-08-16", table, {
  weekendRule: "previous_published",
  scale: 0,
});

describe(c);
// "61.40 USD → 988724 IDR at 16103 [bank_indonesia_middle_rate] (rate from 2026-08-14, 2 days from 2026-08-16)"
```

## API

- `RateTable` — a dumb, indexed set of published rates. It does not fetch,
  interpolate, or invent; feed it what your jurisdiction publishes.
  `on` / `before` / `after` are exact lookups with no implicit fallback.
- `convert(amount, to, date, table, policy)` — returns the converted `Money`
  **and** the rate, its source, its date, and how many days it drifted from the
  event. `maxDriftDays` refuses a rate that is too far away rather than using
  it quietly.
- `weekendRule` is required: `previous_published`, `next_published`, or
  `error`. Tokens trade at the weekend and FX desks do not, there is no
  universally correct answer, and the choice has to be recorded with the figure
  — so there is no default.
- `invert(rate)` — for tables published in one direction only. The inverted
  rate keeps its provenance visible in `source`.
- `coverage(base, quote, dates, table, rule)` — check a whole set of event
  dates *before* an export relies on them, separating "resolved exactly" from
  "resolved by reaching to another day", and listing what nothing can answer.
- `convertAll(items, to, table, policy)` — convert each amount on its own date
  and total them. Throws naming the date it could not resolve, because a total
  that silently skipped an event is worse than no total.

## Contributing

Bugs in the arithmetic matter more here than features. If a figure comes out
wrong, open an issue with the inputs that produced it — a failing test is the
best possible bug report.

```bash
pnpm install
pnpm test        # node --test, no runner
pnpm typecheck
```

## Part of a set

Four small libraries that split the work of keeping a tax record for
self-custodied tokenized stocks. Each stands alone; use one or all four.

| Package | Does |
|---|---|
| [`@accuren/multiplier`](https://github.com/accuren/multiplier) | Exact decimals and the multiplier maths |
| [`@accuren/cost-basis`](https://github.com/accuren/cost-basis) | Lot engine, and whether the event was a sale at all |
| **`@accuren/fx`** | Historical rates carrying source and date — you are here |
| [`@accuren/market-hours`](https://github.com/accuren/market-hours) | Sessions, staleness, and weekend exposure |

> **Not on npm yet.** Clone it, or add it as a git dependency, until the
> first release. `cost-basis` and `fx` depend on `@accuren/multiplier`, so that
> one gets published first.

**Requirements:** Node 22.18+ (native type stripping). No build step, no
bundler, no runtime dependencies — the package exports its TypeScript source
and the tests run on `node --test`.

## Licence

MIT. Part of [Accuren](https://accuren.xyz), which keeps the tax record for
self-custodied tokenized stocks. The archive is the product; the maths is not,
so the maths is public.
