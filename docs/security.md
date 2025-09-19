# Security — EscrowMarket (What’s implemented in code)

**Compiler:** Solidity `0.8.28`  
**Contract:** `EscrowMarket.sol` (Sepolia verified)  
**Design:** CEI (Checks–Effects–Interactions) + **Pull Payments** only

---

## A) Access Control (exact code elements)
- **Admin (immutable):**  
  - Declared as `address public immutable admin;` — set in `constructor() { admin = msg.sender; }`.
- **Role modifiers:**  
  - `onlyAdmin()` → reverts `NotAdmin()`.  
  - `onlySeller(uint256 id)` → checks `deals[id].seller`, reverts `InvalidDeal(id)` / `NotSeller(id)`.  
  - `onlyBuyer(uint256 id)` → checks `deals[id].buyer`, reverts `InvalidDeal(id)` / `NotBuyer(id)`.  
  - `inState(uint256 id, DealState expected)` → reverts `WrongState(expected, got)`.
- **Admin controls (functions):**  
  - `pause()` / `unpause()` → guarded by `onlyAdmin`; state flag `paused`.  
  - `freeze(uint256 id)` / `unfreeze(uint256 id)` → per-deal quarantine.  
  - `setBanned(address account, bool isBanned)` → bans/unbans abusive accounts.

---

## B) Global & Per-Deal Guards
- **Paused (global):**  
  - `whenNotPaused` modifier on mutating funcs; custom error **`Paused()`** on violation.
- **Frozen (per deal):**  
  - `notFrozen(id)` modifier; custom error **`DealFrozen(id)`** on violation.
- **Banned (per account):**  
  - `notBannedForNewDeals` modifier on flows that start deals; custom error **`Banned(account)`**.

---

## C) State Machine (enforced in code)
```text
Listed -> Funded -> Shipped -> Completed
             |                     ^
             └-> Cancelled --------┘
             └-> Disputed (admin resolves)
```
- Enum: `enum DealState { Listed, Funded, Shipped, Completed, Cancelled, Disputed }`

- Strict transitions via `inState(...)`:

  - `ship(id)` requires `Funded`;
  - `confirmReceived(id)` requires `Shipped`;
  - `cancelBeforeShipment(id)` requires `Listed` or `Funded`;
  - `openDispute(id)` requires a disputable state, else `InvalidStateForDispute(got)`.

## D) Funds Flow (Pull Payments + CEI)

- No direct payouts inside business logic.
  - Escrow amounts accumulate in `mapping(address => uint256) public balances`;
- The only ETH-sending path:
  - withdraw() (external) — sets user balance to zero first, then sends; reverts `NothingToWithdraw()` or `SendFailed()` if needed.
  - Ensures reentrancy safety by zeroing balance before external call.
- Funding correctness:
  - `fund(id)` checks `msg.value == price` (else uses `BadPrice()` / `ZeroValue()` accordingly).
  - Prevents self-purchase with `SelfPurchaseNotAllowed(id)`.

## E) Direct ETH Rejection
- `receive()` and `fallback()` both `revert DirectPaymentRejected()` — no unsolicited ETH can enter.
This forces funds to go through `fund(id)` only.

## F) Dispute Handling (admin arbitration)

- Open: `openDispute(id)` (only in valid states, else `InvalidStateForDispute(got)`).
- Resolve: `resolveDispute(id, bool releaseToSeller)` (single function with boolean switch):
  - `true` → release to seller;
  - `false` → refund buyer.
- Event: `DealResolved(id, releasedToSeller)` provides auditable outcome.

## G) Data Model & Packing (gas + clarity)
- Struct:
```text
struct Deal {
    uint256 id;
    address seller;
    address buyer;
    uint128 price;
    uint64  createdAt;
    DealState state;
    string  title;
}
```
- Tight types (`uint128`, `uint64`) reduce storage slots; `title` on-chain (other rich metadata off-chain if any).

- Primary mappings:

  - `deals[id] : Deal`
  - `balances[addr] : uint256` (pull-payments ledger)
  - `frozen[id] : bool`, `banned[addr] : bool`

## H) Custom Errors (all revert without strings)

- `NotAdmin()` — unauthorized admin actions
- `NotSeller(id)`, `NotBuyer(id)`, `NotParticipant(id)` — role violations
- `WrongState(expected, got)`, `InvalidStateForDispute(got)`, `InvalidDeal(id)` — state/validity
- `ZeroValue()`, `BadPrice()` — value checks
- `SelfPurchaseNotAllowed(id)` — seller cannot buy own listing
- `NothingToWithdraw()`, `SendFailed()` — withdrawals
- `DirectPaymentRejected()` — receive/fallback
- `Paused()` — global pause
- `DealFrozen(id)` — per-deal freeze
- `Banned(account)` — banned account trying to start new deal

## I) Events (audit & monitoring)

- Lifecycle: `DealListed(id, seller, price, title)`, `DealFunded(id, buyer, amount)`, `DealShipped(id)`, `DealCompleted(id)`, `DealCancelled(id)`, `DealDelisted(id)`
- Disputes: `DealDisputed(id)`, `DealResolved(id, releasedToSeller)`
- Admin controls: `PausedSet(bool)`, `DealFrozenSet(id, bool)`, `BannedSet(account, bool)`
- Payouts & edits: `Withdrawal(account, amount)`, `DealTitleUpdated(id, title)`

## J) Tested Behaviors (summary)

- Happy path: `list → fund → ship → confirmReceived → withdraw(seller)`
- Cancellations: `cancelBeforeShipment` refunds buyer only in pre-shipping states
- Disputes: `openDispute` then `resolveDispute(id, true/false)` releases to correct party
- Guards: `pause/freeze/ban` enforced; wrong caller/state/value revert with the correct custom error
- Direct ETH: `receive/fallback` revert; no accidental deposits