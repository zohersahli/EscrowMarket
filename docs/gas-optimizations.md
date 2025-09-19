# Gas Optimizations — EscrowMarket

> These optimizations do **not** rely on the Solidity optimizer or upgrading the compiler. They are design/code choices to reduce gas and improve safety.

## 1) Custom Errors (instead of revert strings)
**What:** Use `error ...;` + `revert ErrorName(...)` instead of `require(..., "msg")`.  
**Why:** Revert strings bloat bytecode and cost more on failure.  
**Effect:** Smaller deploy size + cheaper failing paths.

## 2) Immutable for fixed addresses/values
**What:** Make fixed config (e.g., `admin`) `immutable` and set it in the constructor.  
**Why:** Reading from code is cheaper than SLOAD.  
**Effect:** Cheaper authorization checks on every call.

## 3) Struct Packing (tight types & ordering)
**What:** Pack small fields in `Deal` (e.g., `uint128 price`, `uint64 createdAt`, plus state) to share storage slots.  
**Why:** Fewer storage slots → fewer SSTORE/SLOAD.  
**Effect:** Lower gas on writes/reads of deals.

## 4) Cache Storage Reads
**What:** `Deal storage d = deals[id];` then use `d.*` instead of repeating `deals[id].*`.  
**Why:** Storage reads are expensive; a single pointer is cheaper.  
**Effect:** Fewer SLOADs inside hot functions.

## 5) Use `calldata` for External Inputs
**What:** For external functions, prefer `string calldata` / arrays in `calldata`.  
**Why:** Avoids copying arguments to memory.  
**Effect:** Cheaper external calls (especially with larger data).

## 6) Pull Payments + CEI
**What:** Checks–Effects–Interactions and delayed payouts via `withdraw()`.  
**Why:** Safer than pushing ETH; isolates external calls.  
**Effect:** Simpler happy-path logic + fewer costly interactions.

## 7) Early Revert in `receive`/`fallback`
**What:** Immediately `revert` on direct ETH transfers.  
**Why:** Prevents accidental deposits and wastes less gas.  
**Effect:** Clear behavior + cheaper on wrong calls.

## 8) Avoid Unbounded Storage Loops
**What:** Access deals by `dealId` (no enumeration).  
**Why:** Unbounded loops are gas-risky and unpredictable.  
**Effect:** O(1)-like ops and stable gas costs.

---

