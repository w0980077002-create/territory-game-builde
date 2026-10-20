# Wheel of Fortune — review and coordinated installation

This change targets `main` at `3c3a680`. It does not install SQL in production,
merge `main`, reset players, or modify the approved Game Hall skin. The new
screen is reached through the existing wheel card. Treasury keeps its rune
challenge and adds a separate earned-chest inventory that needs no ticket.

## Installation artifact

Apply **only** `supabase/migrations/20261020130000_wheel_fortune.sql` to an
up-to-date TERRITORY database as part of the owner-approved coordinated release,
then publish the reviewed frontend. Do not replay this repository's historical
staged economy migrations against an existing production database.

The migration is one transaction with lock/statement timeouts. It creates three
private tables, protected functions, a read-only entitlement RPC, and a fortune
RPC. It patches the current Hall start function and the two existing Arena VIP
lookups using checked text anchors. Unrecognized function bodies abort the entire
migration rather than replace unknown production logic. Review a database backup
and the actual function definitions before installation; an anchor mismatch needs
engineering review, not removal of the guards. No player data changes during
installation. After installation, run Supabase security advisors and validate the
reviewed feature against a disposable staging account/database before publishing.

Both RPCs grant execution only to `authenticated`; the mutation RPC checks
`auth.uid()` against an existing, non-banned player. Private tables have RLS
without client policies and no public/anon/authenticated privileges. Private
helpers have no client execution grants. No service key is added to the app.

## Exact approved wheel catalogue

| Outcome | Quantity | Weight / 10000 | Chance |
|---|---:|---:|---:|
| Gold | 100 | 3000 | 30.00% |
| Blue gems | 1 | 1400 | 14.00% |
| Blue gems | 3 | 800 | 8.00% |
| Blue gems | 5 | 200 | 2.00% |
| Standard health potion (50 HP) | 1 | 1800 | 18.00% |
| Elixir of Strength (+10 attack, one battle) | 1 | 800 | 8.00% |
| Battle stone | 1 | 1000 | 10.00% |
| Common chest | 1 | 700 | 7.00% |
| Rare chest | 1 | 200 | 2.00% |
| Golden Treasury Key | 1 | 50 | 0.50% |
| VIP | 24 hours | 45 | 0.45% |
| Full hero level | +1 | 5 | 0.05% |
| **Total** | | **10000** | **100.00%** |

The twelve illustrated sectors have equal sizes. The Rules dialog explicitly
explains this and displays actual chances. Secure draws use the random first
32 bits of PostgreSQL `gen_random_uuid()` (outside UUID version/variant bits),
reject values >= 4294960000 and reduce modulo 10000. This avoids modulo bias.
No client RNG selects rewards. There are no red-gem, scroll, or cash rewards.

## Atomicity and recovery

`territory_fortune_v1(p_action,p_key,p_expected)` accepts an action, UUID
idempotency key and existing cloud timestamp. It accepts **no** prize, quantity,
reward definition, player identifier or state snapshot from the client.

Lock order is player `FOR NO KEY UPDATE` → existing Hall account `FOR UPDATE` →
private fortune inventory `FOR UPDATE`. The player lock avoids conflicting with
foreign-key key-share locks in existing Hall/Monopoly inserts. Existing Hall and
Monopoly spending serializes on the same Hall account. A current Hall challenge
prevents spins and chest opening. An unacknowledged fortune receipt prevents a
new Hall challenge; Monopoly rolls use that same guarded Hall start function.

Within one transaction the server validates the exact save revision and wallet,
spends one ticket (or one chest/key), draws, pays canonical resources/inventory,
updates player summary columns and `game_state` together, advances `updated_at`,
and inserts the unique `(player_id,operation_id)` receipt. Any exception rolls
back all of these changes. One partial unique index permits only one unseen
receipt per player. A fresh operation from a second device recovers that receipt
without another debit. Receipts have no automatic expiry/deletion.

Retries check receipts **before** revision validation. They return the recorded
prize with the **current** server snapshot, not an old cached payout snapshot.
An acknowledgement only marks presentation complete; it never grants a reward.
Replaying an acknowledged key still cannot debit or pay again.

The client flushes the exact current save before a new transaction. It persists
only `{action,key,expected}` locally, never a wallet or a chosen prize. It blocks
and invalidates old queued saves while the response is uncertain, then installs
the server receipt through the existing Monopoly wallet/revision validator. A
network failure retains the key. Recovery after remount/restart retries that
same key. A definitive PostgreSQL rollback is reconciled against current server
state before clearing the marker. Stale-revision conflicts never start a new
spin automatically. The user can always reopen Wheel/Treasury to recover.

Prizes are already committed when animation begins. Skip changes presentation
only. Leaving during animation leaves the unseen server receipt available for
recovery. The animation lasts 5.2 seconds, uses transforms, haptics and a fixed
pointer, and has a reduced-motion path. No sound or ad/payment provider is added.

## Full level and VIP

Full-level payouts increment the hero by exactly one. They preserve existing XP
unless reaching 100, recompute `xpToNext` with the unchanged existing formula,
grant +20 max HP/full base HP, +5 attack, +2 defense and +1 max energy, and unlock
existing followers at their canonical thresholds without resetting training.
Existing equipment normalization and summary triggers continue to run. At level
100 the original five-in-10000 draw still occurs; its receipt is `refunded:true`
and the ticket is retained atomically. The UI says that no level was granted and
that the player may spin again. No alternative payout or reweighted draw occurs.

Temporary VIP is tier 1, using the existing Arena VIP checks. `vip_level` remains
the permanent entitlement and is never modified. Effective tier is
`greatest(permanent_vip, vip_until > server_now ? 1 : 0)`. A win adds 24 hours to
`greatest(server_now,vip_until)`. Expiration is checked by the database, not the
device clock. Login, WebView resume and foreground minute refreshes retrieve the
server entitlement; the home badge shows remaining hours. Higher permanent VIP
levels and existing VIP powers are preserved. The wheel shows the server expiry.

## Conservative, configurable chest loot

Every opening chooses **one** row below. Each kind totals exactly 10000; the RPC
refuses opening if an administrator configures a different total. Definitions
are in `territory_private.fortune_loot_v1`, writable by trusted database operators
only. Changing them never changes the twelve wheel outcome weights. No equipment
or new currency is minted. Materials use the existing `forgeMaterials` resource.

| Chest | Loot | Quantity | Weight | Chance |
|---|---|---:|---:|---:|
| Common | Gold | 30 | 4000 | 40% |
| Common | Standard health potion | 1 | 3000 | 30% |
| Common | Battle stone | 1 | 2000 | 20% |
| Common | Forge material | 1 | 1000 | 10% |
| Rare | Gold | 60 | 2500 | 25% |
| Rare | Blue gems | 2 | 2000 | 20% |
| Rare | Elixir of Strength | 1 | 2000 | 20% |
| Rare | Battle stones | 2 | 2000 | 20% |
| Rare | Forge materials | 2 | 1500 | 15% |
| Golden (one key) | Gold | 100 | 2500 | 25% |
| Golden (one key) | Blue gems | 3 | 2500 | 25% |
| Golden (one key) | Elixirs of Strength | 2 | 2000 | 20% |
| Golden (one key) | Battle stones | 3 | 2000 | 20% |
| Golden (one key) | Forge materials | 3 | 1000 | 10% |

Each opening consumes exactly one stored chest or Golden Key, requires no Hall
ticket and uses the same atomic receipt/recovery protocol. Golden opening has a
separate illuminated chest animation. Potions/elixirs stack by canonical name,
type and exact effect, matching the existing Shop and Monopoly definitions.

## Validation performed

Passed locally:

- `npm run typecheck`
- `npm run test:wheel` — executable SQL in isolated PGlite plus real client module
  with transport/storage test fixtures; exhaustive 10000-position probability
  audit, every payout/loot branch, wallet revisions, idempotency/restart/retries,
  fresh second-device keys, duplicate submissions, account isolation, SQL failure
  rollback after payout, chest/key spending, VIP extension/expiry/permanent tier,
  levels 10→11/14→15/82→83/99→100/100 refund, Hall games and daily +2.
- `npm run test:hall`
- `npm run test:economy`
- `npm run test:saves`
- `npm run test:progression`
- `npm run test:professions`
- `npm run build`
- Additional preservation checks: `test:mobile-home`, `test:admin-master`,
  `test:balance`, `test:feature-separation`, and the Monopoly v2, test-build and
  visual-structure suites.

A PR-only workflow runs the above checks without deployment. No tests connect to
production or consume real tickets. Art is local: one optimized 225 KiB WebP
chamber/hostess illustration, small gold-framed SVG reward assets, and existing
canonical resource artwork. No runtime dependencies were added.

## Verification limits / release blockers

1. This workspace blocks Chromium's required socket operation. The offline
   browser preview was built, but screenshot/layout tests could not launch.
   `npm run test:wheel:browser` contains width 320/360/390/430, rules, recovery,
   double-click, golden opening, reduced motion and animation-skip checks for an
   unrestricted environment with Python Playwright and Chromium. These are
   **unverified**, including Android/iPhone Telegram device behavior.
2. PGlite executes PostgreSQL functions and rollback tests but serializes
   connections. Simultaneous requests are tested as serialized competing calls;
   actual multi-connection PostgreSQL lock/deadlock stress and staging installation
   against the full live trigger/function set remain required before production.
3. Existing economy tests explicitly report that legacy direct player-save writes
   remain enabled and the wider server-authoritative economy cutover is blocked.
   This PR does not claim to fix that pre-existing arbitrary-save/anti-cheat
   surface or certify the whole economy as exploit-proof. New fortune tables are
   private and new rewards can only be selected/paid through protected RPCs;
   honest stale-device autosaves use the existing revision/CAS protocol. The
   wider legacy write surface needs a separate coordinated security decision.
4. No production SQL, production advisors, live account test, merge or deployment
   was run. The approved migration and staging/device validation must precede a
   production-ready declaration. Existing migration history has mixed staged/live
   artifacts; use the single new installation artifact, not a database reset.
