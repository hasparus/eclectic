# Type-safety audit — `packages/memoriam`

Generated 2026-06-02. svelte-check exits clean (0 errors / 8
unrelated Svelte-runes warnings). This report enumerates the
`any`, `as`, and force-cast surface area that survives strict
TS — what's load-bearing, what's vestigial, what's a real
boundary that should validate with arktype.

## Headline numbers

| Category | Count |
| --- | --- |
| `as any` | 33 |
| `as unknown as <Type>` | 23 |
| `: any` (annotations, includes Record<string, any>) | 53 |
| `Record<string, any>` specifically | 33 |
| `!` non-null assertions | 9 |
| `JSON.parse(...)` (untyped result) | ~10 |
| `// @ts-ignore` / `@ts-expect-error` | **0** ← good |
| `eslint-disable` | **0** ← good |

`noImplicitAny` is on (`strict: true` in tsconfig.json); no
implicit-any errors remain. `noUncheckedIndexedAccess: false` —
worth turning on, see §F.

---

## A. Real trust boundaries that should validate (arktype)

These are places where untyped data crosses INTO the type system
from outside. A force-cast here is a lie that can crash three
frames deeper.

### A1. JSON.parse on SQLite `documents.data` — `api.remote.ts` x4, `automerge_server.ts` x2 ★ HIGH

```ts
// src/lib/api.remote.ts:295, 306, 374, 1109, 1462
const pageDoc = JSON.parse(docRow.data) as DocumentData;
```

The row's `data` column holds a serialized `{ document_id, nodes }`
blob written by `saveDocument`. There's no schema check — a
migration that drops a key, or an Automerge sync that wrote a
divergent shape, sails through.

**Fix:** define a `DocumentDataSchema` arktype next to
`DocumentRowSchema` and parse: `DocumentDataSchema(JSON.parse(...))`.
Cheap — the JSON is already in memory.

### A2. JSON.parse in migrations — `migrations.ts` x2, others ★ MEDIUM

```ts
// src/lib/server/migrations.ts:130, 159
const doc = JSON.parse(row.data);
```

Migrations rewrite documents in place. Their input shape is
*old* by definition — schema can't be fixed, but the cast can
become an explicit `unknown` + targeted narrowing on the fields
the migration touches.

### A3. `documentSchema as Record<string, any>` — 6 sites ★ LOW

```ts
// src/lib/api.remote.ts:235, document_graph.ts:28
const typeSchema = (documentSchema as Record<string, any>)[node.type];
```

`documentSchema` is *our own* static schema, not external data.
The cast is just narrowing for an indexed read where TS lacks
key inference. Either type `documentSchema` properly (it's a
discriminated record keyed on node type names) or accept this as
a low-risk shorthand. Not a boundary violation.

### A4. `Automerge.splice` / `DocHandle` shapes — `session_automerge_client.svelte.ts` x3 ★ LOW

```ts
}) as unknown as RepoLike;                   // line 58
automerge.splice as unknown as SpliceFn      // line 95
handle as unknown as { off?: () => void }    // line 97
```

These are *intentional* — we have local interfaces (`RepoLike`,
`SpliceFn`) that narrow the third-party Automerge surface to the
1-3 methods we actually use, so Session doesn't have to import
the whole `@automerge/automerge-repo` type tree. Not worth
fixing; the narrowing is the value.

---

## B. Vestigial force-casts from the JSDoc → TS conversion ★ HIGH — easy wins

These exist because the conversion landed when `Session` /
`Transaction` were less typed. They cast through `unknown` to
methods that **now exist on the real classes**. They should just
be deleted.

### B1. `Command.svelte.ts` — 8 needless `session as unknown as { ... }` ★ HIGH

```ts
// line 80
(this.context.session as unknown as { select_parent: () => void }).select_parent();

// line 100
(this.context.session as unknown as { active_annotation: (t?: string) => unknown }).active_annotation(...)

// lines 108, 124, 153, 168, 170, 295
```

Every method named in those casts (`select_parent`,
`active_annotation`, `tr`, `apply`, `inspect`) is a real method
on `Session` / `Transaction`. The casts are doing nothing useful
— delete and let the class types flow through.

**Estimated effort:** ~15 minutes; mechanical. Already covered
by the existing test suite.

### B2. `Svedit.svelte` — `as unknown as Range` (StaticRange) ★ LOW

```ts
// line 104
event.getTargetRanges()[0] as unknown as Range
```

`InputEvent.getTargetRanges()` returns `StaticRange[]`, not
`Range[]`. They share the field surface we read but are
distinct DOM types. Could legitimately be either:

- accept `Range | StaticRange` in `__get_text_selection_from_dom`
- build a shim `staticRangeToRange()`

Keeping the cast is fine — flag this as "documented narrowing"
rather than a regression risk.

### B3. `Svedit.svelte` — `context as unknown as Parameters<typeof create_gap_computation>[0]` ★ MEDIUM

```ts
// line 81
create_gap_computation(context as unknown as Parameters<typeof create_gap_computation>[0]);
```

`create_gap_computation` takes a `SveditContext` interface
defined locally in `node_gap_computation.svelte.ts`. The cast is
because the App-side context type has additional fields. Fix:
export `SveditContext` and have App's context `extends` it (or
just widen the parameter type).

### B4. `Svedit.svelte:560` — `inspect(...) as unknown as { node_types }` and `Session.svelte.ts:395`, `Transaction.svelte.ts:698` ★ MEDIUM

```ts
inspect(path) as unknown as { node_types: string[] }
```

`inspect()` returns `{ kind: 'property' | 'node'; [key: string]: unknown }`. Narrowing
via plain `as { node_types: string[] }` fails because the index
signature says `unknown`, so we route through `unknown`.

**Better fix:** add a discriminated return type to `inspect`:
```ts
type InspectResult =
  | { kind: 'property'; type: PropertyType; node_types?: string[]; ... }
  | { kind: 'node'; id: string; type: string; properties: ... };
```
Then callers narrow on `kind` instead of casting blind.

---

## C. `Session.get` / `Transaction.get` returning `any` ★ ARCHITECTURAL

```ts
// Session.svelte.ts:350, Transaction.svelte.ts:83, doc_utils.ts:205
get(path: DocumentPath | string): any
```

The comment in doc_utils.ts says it best: *"Returns `any` because
the result type depends on the path. Most callers know what they
expect."* Schema-driven, path-dependent shapes are not statically
inferable without sophisticated dependent types.

This is a **deliberate** loose-typing decision. Don't fix —
trying to type-narrow this would require a massive generic
machinery for marginal benefit. The cost shows up in the 33 `as
any` and `Record<string, any>` casts downstream, but tightening
would require typing the full document schema as a discriminated
union and threading path-based inference.

**Possible mitigation:** an opt-in narrow helper:
```ts
session.getAs<MyNode>(path, MyNodeSchema)  // arktype-validated
```
for hot spots where the shape matters. Not urgent.

---

## D. `Record<string, any>` & `node: any` in document operations ★ MEDIUM

33 `Record<string, any>` and ~6 `node: any` annotations across:
- `api.remote.ts` (collectDocumentRefs, extractDocument, ...)
- `document_graph.ts::collectNodeIdsInOrder`
- `svedit/transforms.svelte.ts` (predecessor_node, node, node_array_node)
- `routes/app_utils.ts` (`session as any`, `selected as any`)

All on document content where the shape *is* schema-defined but
TS can't see it without dependent types (see §C). Same trade-off.

**Practical fix for `app_utils.ts`:** the file is small (~150
lines) and self-contained; replace `as any` with a tight
discriminated union for the 2-3 node shapes it actually reads
(`selectable`, `colorset` carriers). Worth doing.

---

## E. Non-null assertions (`x!`) — 9 sites ★ MEDIUM-LOW

```ts
// src/lib/tree_layout.ts:64
parentsOf.get(e.child_id)!.push(e.parent_id);  // OK — `get` after ensured `set`

// src/lib/svedit/Svedit.svelte:1119, 1121, 1124, 1126
if (node === range!.startContainer) { ... }    // OK — range is set above

// src/lib/svedit/Transaction.svelte.ts:281
return id_map[depth_first_nodes.at(-1)!.id];   // crashes on empty input

// src/routes/components/Overlays.svelte:223
<EditMedia path={svedit.session.selection!.path} />  // crashes if selection nulls between $derived and click
```

Most are local "TS can't see the invariant" cases — fine.
`Transaction.svelte.ts:281` and `Overlays.svelte:223` are the
worrying ones: both assume non-null where async / reactive state
could be null. Worth converting to explicit checks.

---

## F. Hardening opportunities (tsconfig)

```json
"noUncheckedIndexedAccess": false
```

Flip to `true` to surface `array[i]` and `record[key]` as
`T | undefined`. Would force ~50-100 narrowing checks across the
codebase but catches an entire class of "user clicked before
data arrived" bugs at compile time (the hydration-race bug
class we just fixed).

Not a one-shot fix — would need to triage call sites — but
worth opening as a tracked migration.

---

## Recommendations, ordered

1. **§B1: Drop the 8 vestigial `session as unknown as { ... }` casts in `Command.svelte.ts`.** Pure cleanup, ~15 min, no behavior change.
2. **§A1: Wrap the 4–5 `JSON.parse(docRow.data) as DocumentData` sites with an arktype `DocumentDataSchema` validator.** Same pattern as `parseRow` — this is the next obvious boundary. ~30 min.
3. **§B4: Discriminate `inspect()`'s return type.** Eliminates 3 force-casts and improves IDE narrowing across all callers. ~1 hr.
4. **§D (`app_utils.ts`)**: tighten the file-local node shapes. ~30 min.
5. **§E**: audit the 2 risky `!` sites in `Transaction.svelte.ts:281` and `Overlays.svelte:223`. ~15 min each.
6. **§F**: open a ticket for `noUncheckedIndexedAccess: true`. Multi-day migration.

Skip §C and the Automerge narrowings (§A4) — those are
intentional design decisions with no payoff from tightening.
