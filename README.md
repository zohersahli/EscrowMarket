# EscrowMarket — Smart-Contract Inlämningsuppgift 

Secure buyer–seller escrow marketplace on Ethereum. Includes full tests, high coverage, and verified Sepolia deployment.

---

## A) 🧠 Overview (What & Why)
**Goal:** enable safe payments between a buyer and a seller using an escrow contract that holds funds until delivery is confirmed.

**Actors**
- **Seller**: lists an item with a price and optional metadata.
- **Buyer**: funds the deal and later confirms delivery.
- **Admin**: emergency controls (pause), dispute resolution, freeze/ban.

**Lifecycle (high level)**
1. **Listed** → Seller creates a deal.
2. **Funded** → Buyer pays exact price into the contract.
3. **Shipped** → Seller marks the item as shipped.
4. **Completed** → Buyer confirms receipt; seller’s balance becomes withdrawable.
5. **Withdrawn** → Seller pulls funds.
6. **Cancelled** (before shipping) → Buyer refunded.
7. **Disputed** → Admin resolves to seller or buyer.

**Guarantees**
- Funds are held in-contract; no direct transfer to the seller before confirmation.
- Buyer can be refunded if the item hasn’t been shipped.
- Admin can resolve disputes deterministically (events logged).
- All sensitive flows emit events for auditability and off-chain indexing.

**Trust & Safety**
- **Pull payments** (seller withdraws later) + **CEI** pattern to minimize reentrancy risk.
- **receive/fallback** reject unintended ETH transfers.
- **Pause/Freeze/Ban** controls for incident response.

---

## B)  State Machine
```bash
stateDiagram
    [*] --> Listed
    Listed --> Funded: fund()
    Funded --> Shipped: ship() (seller)
    Funded --> Cancelled: cancelBeforeShipment() (per rules)
    Shipped --> Completed: confirmReceived() (buyer)
    Funded --> Disputed: openDispute()
    Shipped --> Disputed: openDispute()
    Disputed --> Completed: resolveDispute(toSeller=true) (admin)
    Disputed --> Cancelled: resolveDispute(toSeller=false) (admin)
    Completed --> [*]
    Cancelled --> [*]
```

## C)  Data Model (short)
```bash
struct Deal { seller, buyer, price (uint128), state, createdAt (uint64), title }

enum DealState { Listed, Funded, Shipped, Completed, Cancelled, Disputed }

mapping(uint256 => Deal) deals; (+ balances mapping for pull-withdrawals)

Events for: List/Fund/Ship/Confirm/Cancel/Dispute/Resolve/Withdraw/Pause/Unpause/TitleUpdated
```

## D) 📌 TL;DR
- **Theme:** #2 Marknadsplats för säker betalning (Escrow)
- **Network:** Sepolia  
- **Deployed:** `0x27013b43c40fB4fB0c23DD0E56f1fB90FA8a0276`  
- **Etherscan (Verified):** https://sepolia.etherscan.io/address/0x27013b43c40fB4fB0c23DD0E56f1fB90FA8a0276#code
- **Coverage:** Lines **100%**, Statements **95.37%** (see escrow/docs/screenshots/coverage.png`)

---

## E) Contract Overview

Core roles: Admin / Seller / Buyer

**Key flows**

1) `list` → create deal (**Listed**)

2) `fund` → buyer funds (**Funded**)

3) `ship` → seller marks shipped (**Shipped**)

4) `confirmReceived` → buyer confirms → seller’s balance accrues (**Completed**)

5) `withdraw` → seller pulls funds

**Additional**

- `cancelBeforeShipment` (refund before shipping)

- `openDispute` / `resolveDispute` (admin settles to seller/buyer)

**DealState**: `Listed → Funded → Shipped → Completed (+ Cancelled, Disputed)`

(Function names may appear slightly different in code; tests document exact signatures.)


## F) 🚀 Quick Start (Grading / Review)
> Fastest way to run locally..

```bash
npm i
npx hardhat compile
npx hardhat test
npx hardhat coverage
```
**Expected**: all tests passing; coverage ≈ 95%+.

**🧪 What’s Tested**

- Happy path: list → fund → ship → confirm → withdraw

- Reverts: NotSeller/NotBuyer/WrongState/ZeroValue/BadPrice/…

- Dispute flows: resolve to seller or buyer

- Admin controls: pause/freeze/ban

- `receive`/`fallback`: reject unintended payments


## G) Deploy & Verify (Repro)

Only needed if you want to redeploy. Uses Hardhat keystore (no secrets in code/Git).
```bash
npx hardhat keystore set SEPOLIA_RPC_URL        # Alchemy/Infura HTTPS (Sepolia)
npx hardhat keystore set SEPOLIA_PRIVATE_KEY    # MetaMask test account (prefix with 0x)
npx hardhat keystore set ETHERSCAN_API_KEY      # etherscan.io API key

npx hardhat compile
npx hardhat ignition deploy ./ignition/modules/EscrowMarket.ts --network sepolia --verify
# optional verify (or do it separately):
npx hardhat ignition verify <DeploymentId>
# or:
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS>
```

## H) Security &  Gas (Brief)

- CEI + Pull payments: safer external interactions; avoids reentrancy pitfalls

- Custom errors: cheaper than long revert strings

- `immutable` admin: reduces storage reads

- Struct packing (e.g., `uint128/uint64/enum`): fewer storage slots

- receive/fallback policy: rejects direct/unknown calls

**Details in** `docs/security.md` and `docs/gas-optimizations.md`.




## I) Author
Developed by Zoher Sahli – blockchain and full-stack developer student.

