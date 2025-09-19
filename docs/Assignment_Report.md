# Assignment Report — EscrowMarket (Inlämningsuppgift)

**Theme chosen:** #2 — Marketplace for secure buyer–seller payment (Escrow)  
**Contract:** `EscrowMarket.sol` (Solidity 0.8.28)  
**Network:** Sepolia  
**Deployed & Verified:** `0x27013b43c40fB4fB0c23DD0E56f1fB90FA8a0276`  
**Etherscan:** https://sepolia.etherscan.io/address/0x27013b43c40fB4fB0c23DD0E56f1fB90FA8a0276#code

---

## 1) Overview

**Goal.** Provide an escrow flow where funds are held on-chain until the buyer confirms delivery, or an admin settles a dispute.
Any user can list an item (list), a buyer funds the deal (fund), the seller marks it shipped (ship), and the buyer confirms receipt (complete) which releases payment to the seller. Before shipping, the deal can be cancelled and refunded. If a dispute arises, an admin resolves it by either releasing funds to the seller or refunding the buyer.

- Language: Solidity 0.8.28
- License: MIT
- Design: Checks–Effects–Interactions + Pull Payments
- Stack: Hardhat + TypeScript tests + Ignition (deployment)

**Actors.**
- **Seller:** lists an item, ships.
- **Buyer:** funds the deal, confirms receipt, can cancel **before** shipping.
- **Admin:** pause/unpause, freeze a deal, ban addresses, resolve disputes.

**Lifecycle.**
`Listed → Funded → Shipped → Completed` (+ `Cancelled`, `Disputed`)

## 2) State Model
`enum DealState` flow:
```bash
Listed -> Funded -> Shipped -> Completed
             |                     ^
             └-> Cancelled --------┘
             └-> Disputed (Admin resolves: ReleaseToSeller or RefundToBuyer)
```
Notes:

- Cancellation allowed only before shipping.

- In `Disputed`, only admin can decide; no direct withdrawals.

- Global and per-deal safeguards: pause / freeze / ban.

## 3) Core Data Structures

- Mappings:

    1) `mapping(uint256 => Deal) deals` — deal storage.
    2) `mapping(address => uint256) pendingWithdrawals` — pull-payments ledger.
    3) `mapping(uint256 => bool) frozen` — per-deal freeze.
    4) `mapping(address => bool) banned` — address ban list.

- Events for list, fund, ship, complete, cancel, open/resolve dispute, freeze/ban changes, withdrawals.
- **Struct `Deal`**: `id`, `seller`, `buyer`, `price (uint128)`, `createdAt (uint64)`, `state (DealState)`, `title (string)`.


## 4) Key Public APIs
(All sensitive functions enforce modifiers and `inState` where relevant.)

- `list(uint128 price, string calldata title)` — Create a new deal with an on-chain title.
- `updateTitle(uint256 id, string calldata title)` — Seller can edit the title while the deal is still `Listed`.
- `fund(uint256 id)` — Fund a deal with `msg.value == price`.
- `ship(uint256 id)` — Seller marks as shipped.
- `complete(uint256 id)` — Buyer confirms; funds move to `pendingWithdrawals[seller]`.
- `cancel(uint256 id)` — Cancel before shipping; refund buyer.
- `openDispute(uint256 id)` — Open a dispute.
- `resolveDisputeReleaseToSeller(uint256 id)` / `resolveDisputeRefundToBuyer(uint256 id)` — Admin decision.
- `withdraw()` — Pull pending funds.
- Safeguards:
`setPaused(bool)`, `setFrozen(id,bool)`, `setBanned(address,bool)`.

## 5) Gas Optimizations (Summary)
Full details in `docs/gas-optimizations.md`.

1) `Custom Errors` instead of `require(string)` → cheaper reverts.
2) `Immutable admin` → cheaper reads & fixed authority.
3) Struct packing in `Deal` (tight variable sizing/order) → storage savings.
4) `Pull Payments + CEI` → fewer storage writes during transfers, safer flow.
5) Fewer storage reads using local `Deal storage d = deals[id];`.


## 6) Security (Summary)
Full analysis in `docs/security.md`.

1) Reentrancy: Pull-payments + CEI; state updates before external interactions.
2) Authorization: strict `onlyAdmin/onlySeller/onlyBuyer` + `banned/frozen/paused`.
3) Direct transfers: `receive/fallback` revert `(DirectPaymentRejected)`.
4) Disputes: Admin-only resolution path; prevents fund theft mid-conflict.
5) Tests: cover critical paths (list/fund/ship/complete/cancel/dispute/withdraw + guards).

## 7) Tests & Coverage
Run:
```bash
npm i
npx hardhat test
npx hardhat coverage
```
Screenshots in `docs/screenshots/`:
- `test details.JPG` — passing tests.
- `test-coverage.JPG` — > 90% coverage.
- `test.JPG` — overview (optional).

## 8) Known Limitations

- No multi-sig admin (single admin model).
- No marketplace fee mechanism (could be added later).
- No automatic timeouts for completion (could be added later).

## 9) Important Folders
`contracts/EscrowMarket.sol`

`test/EscrowMarket.ts`

`ignition/modules/EscrowMarket.ts`

`docs/ (Assignment_Report.md + gas-optimizations.md + security.md + screenshots/)`

## 10) G-level Requirements (Met)

| Requirement                | Where in code                                                          |
| -------------------------- | ---------------------------------------------------------------------- |
| At least one struct/enum   | `struct Deal`, `enum DealState` ✅                                      |
| At least one mapping/array | Multiple `mapping` as above ✅                                          |
| Constructor                | Sets immutable `admin` and initial config ✅                            |
| Custom modifier            | `onlyAdmin`, `onlySeller`, `onlyBuyer`, `inState`, etc. ✅              |
| Event(s)                   | Emitted on all critical actions ✅                                      |
| Basic tests                | `test/EscrowMarket.ts` covers core flows ✅                             |
| Test coverage ≥ 40%        | Achieved **> 90%** (screenshot `docs/screenshots/test-coverage.JPG`) ✅ |

## 11) VG-level Requirements (Met)
| Requirement                                        | Where in code                                                                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom error** + `require` + `assert` + `revert` | Custom errors like `NotAdmin()`, `WrongState(...)`, `DirectPaymentRejected()`. Uses `require` for checks, an `assert` in the completion path for invariants, and `revert` in `fallback/receive`. ✅ |
| **fallback/receive**                               | Both implemented and **reject direct ETH** via `DirectPaymentRejected`. ✅                                                                                                                          |
| Deploy to Sepolia + verify on Etherscan            | Done. **Etherscan link:** **\[https://sepolia.etherscan.io/address/0x27013b43c40fB4fB0c23DD0E56f1fB90FA8a0276#code]** ✅                                                                                                                                        |
| Test coverage ≥ **90%**                            | See `docs/screenshots/test-coverage.JPG`. ✅                                                                                                                                                        |
| ≥ 3 gas/safety improvements explained              | Documented in `docs/gas-optimizations.md` and `docs/security.md` (see sections 5–6 up). ✅                                                                                                       |

