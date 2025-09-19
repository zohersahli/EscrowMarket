import { expect } from "chai";
import { parseEther } from "ethers";
import { network } from "hardhat";
const { ethers } = await network.connect();

describe("EscrowMarket", function () {
  // Helper: enum state numbers for readability
  const STATE = {
    Listed: 0,
    Funded: 1,
    Shipped: 2,
    Completed: 3,
    Cancelled: 4,
    Disputed: 5,
  };

  async function deployEscrowMarketFixture() {
    const [admin, seller, buyer, other] = await ethers.getSigners();
    const EscrowMarket = await ethers.getContractFactory("EscrowMarket");
    const escrowMarket = await EscrowMarket.deploy();
    return { escrowMarket, admin, seller, buyer, other };
  }

  // ==== Deployment / Admin ===
  it("assigns deployer as admin", async () => {
    const { escrowMarket, admin } = await deployEscrowMarketFixture();
    expect(await escrowMarket.admin()).to.equal(admin.address);
  });

  it("admin can pause/unpause with events", async () => {
    const { escrowMarket, admin } = await deployEscrowMarketFixture();

    await expect(escrowMarket.connect(admin).pause())
      .to.emit(escrowMarket, "PausedSet")
      .withArgs(true);

    await expect(escrowMarket.connect(admin).unpause())
      .to.emit(escrowMarket, "PausedSet")
      .withArgs(false);
  });

  // ===== list / updateTitle ======
  it("list: creates a deal, emits event, and fills fields", async () => {
    const { escrowMarket, seller } = await deployEscrowMarketFixture();
    const price = parseEther("1");
    const title = "item A";

    await expect(escrowMarket.connect(seller).list(price, title))
      .to.emit(escrowMarket, "DealListed")
      .withArgs(1n, seller.address, price, title);

    const d = await escrowMarket.deals(1);
    expect(d.id).to.equal(1n);
    expect(d.seller).to.equal(seller.address);
    expect(d.buyer).to.equal(ethers.ZeroAddress);
    expect(d.price).to.equal(price);
    expect(d.state).to.equal(STATE.Listed);
    expect(d.title).to.equal(title);
  });

  it("list: rejects price 0 with ZeroValue", async () => {
    const { escrowMarket, seller } = await deployEscrowMarketFixture();
    await expect(escrowMarket.connect(seller).list(0, "x"))
      .to.be.revertedWithCustomError(escrowMarket, "ZeroValue");
  });

  it("updateTitle: only seller and only in Listed state", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.5");

    const id = await escrowMarket.connect(seller).list(price, "old").then(tx => tx.wait())
      .then(() => 1);

    await expect(escrowMarket.connect(seller).updateTitle(id, "new"))
      .to.emit(escrowMarket, "DealTitleUpdated")
      .withArgs(id, "new");

    expect((await escrowMarket.deals(id)).title).to.equal("new");

    // not buyer
    await expect(escrowMarket.connect(buyer).updateTitle(id, "x"))
      .to.be.revertedWithCustomError(escrowMarket, "NotSeller")
      .withArgs(id);

    // after funding becomes WrongState
    await escrowMarket.connect(buyer).fund(id, { value: price });
    await expect(escrowMarket.connect(seller).updateTitle(id, "again"))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");
  });

  // === fund ===
  it("fund: succeeds with exact amount, records buyer, and updates state", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("1");

    const id = await escrowMarket.connect(seller).list(price, "A").then(() => 1);

    await expect(escrowMarket.connect(buyer).fund(id, { value: price }))
      .to.emit(escrowMarket, "DealFunded")
      .withArgs(id, buyer.address, price);

    const d = await escrowMarket.deals(id);
    expect(d.state).to.equal(STATE.Funded);
    expect(d.buyer).to.equal(buyer.address);
  });

  it("fund: rejects self-purchase, BadPrice, and WrongState", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.1");
    const id = await escrowMarket.connect(seller).list(price, "X").then(() => 1);

    // seller cannot fund own deal
    await expect(escrowMarket.connect(seller).fund(id, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "SelfPurchaseNotAllowed")
      .withArgs(id);

    // wrong value
    await expect(escrowMarket.connect(buyer).fund(id, { value: parseEther("0.09") }))
      .to.be.revertedWithCustomError(escrowMarket, "BadPrice");

    // first funding passes
    await escrowMarket.connect(buyer).fund(id, { value: price });
    // funding again => WrongState
    await expect(escrowMarket.connect(buyer).fund(id, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");
  });

  // == ship ==
  it("ship: only seller, and only from Funded state", async () => {
    const { escrowMarket, seller, buyer, other } = await deployEscrowMarketFixture();
    const price = parseEther("0.2");
    const id = await escrowMarket.connect(seller).list(price, "Ship Me").then(() => 1);

    // before funding --> WrongState
    await expect(escrowMarket.connect(seller).ship(id))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");

    await escrowMarket.connect(buyer).fund(id, { value: price });

    // not seller
    await expect(escrowMarket.connect(other).ship(id))
      .to.be.revertedWithCustomError(escrowMarket, "NotSeller")
      .withArgs(id);

    await expect(escrowMarket.connect(seller).ship(id))
      .to.emit(escrowMarket, "DealShipped")
      .withArgs(id);

    expect((await escrowMarket.deals(id)).state).to.equal(STATE.Shipped);
  });

  // ===== confirmReceived ===
  it("confirmReceived: only buyer, and from Shipped --> accrues balance to seller", async () => {
    const { escrowMarket, seller, buyer, other } = await deployEscrowMarketFixture();
    const price = parseEther("1");
    const id = await escrowMarket.connect(seller).list(price, "Phone").then(() => 1);

    await escrowMarket.connect(buyer).fund(id, { value: price });
    await escrowMarket.connect(seller).ship(id);

    // not buyer
    await expect(escrowMarket.connect(other).confirmReceived(id))
      .to.be.revertedWithCustomError(escrowMarket, "NotBuyer")
      .withArgs(id);

    await expect(escrowMarket.connect(buyer).confirmReceived(id))
      .to.emit(escrowMarket, "DealCompleted")
      .withArgs(id);

    const d = await escrowMarket.deals(id);
    expect(d.state).to.equal(STATE.Completed);
    expect(await escrowMarket.balances(seller.address)).to.equal(price);
  });

  // === cancelBeforeShipment ===
  it("cancelBeforeShipment: from Funded and before shipping --> credit buyer", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.7");
    const id = await escrowMarket.connect(seller).list(price, "Cancel Me").then(() => 1);

    await escrowMarket.connect(buyer).fund(id, { value: price });

    await expect(escrowMarket.connect(buyer).cancelBeforeShipment(id))
      .to.emit(escrowMarket, "DealCancelled")
      .withArgs(id);

    const d = await escrowMarket.deals(id);
    expect(d.state).to.equal(STATE.Cancelled);
    expect(await escrowMarket.balances(buyer.address)).to.equal(price);

    // after cancel, cannot confirm nor fund
    await expect(escrowMarket.connect(buyer).confirmReceived(id))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");
    await expect(escrowMarket.connect(buyer).fund(id, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");
  });

  it("cancelBeforeShipment: after shipping --> WrongState", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.3");
    const id = await escrowMarket.connect(seller).list(price, "Y").then(() => 1);
    await escrowMarket.connect(buyer).fund(id, { value: price });
    await escrowMarket.connect(seller).ship(id);

    await expect(escrowMarket.connect(buyer).cancelBeforeShipment(id))
      .to.be.revertedWithCustomError(escrowMarket, "WrongState");
  });

  // === deleteList ===
  it("deleteList: only seller in Listed; removes the record", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const id = await escrowMarket.connect(seller).list(parseEther("0.11"), "Temp").then(() => 1);

    await expect(escrowMarket.connect(seller).deleteList(id))
      .to.emit(escrowMarket, "DealDelisted")
      .withArgs(id);

    const d = await escrowMarket.deals(id);
    expect(d.seller).to.equal(ethers.ZeroAddress);

    // on deleted record: InvalidDeal for some functions
    await expect(escrowMarket.connect(buyer).fund(id, { value: parseEther("0.11") }))
      .to.be.revertedWithCustomError(escrowMarket, "InvalidDeal")
      .withArgs(id);
  });

  // === Dispute / Resolve ===
  it("openDispute: seller or buyer only; allowed only in Funded/Shipped", async () => {
    const { escrowMarket, seller, buyer, other } = await deployEscrowMarketFixture();
    const price = parseEther("0.05");
    const id = await escrowMarket.connect(seller).list(price, "B").then(() => 1);

    // from Listed --> InvalidStateForDispute
    await expect(escrowMarket.connect(seller).openDispute(id))
      .to.be.revertedWithCustomError(escrowMarket, "InvalidStateForDispute")
      .withArgs(STATE.Listed);

    await escrowMarket.connect(buyer).fund(id, { value: price });

    // not a participant
    await expect(escrowMarket.connect(other).openDispute(id))
      .to.be.revertedWithCustomError(escrowMarket, "NotParticipant")
      .withArgs(id);

    await expect(escrowMarket.connect(buyer).openDispute(id))
      .to.emit(escrowMarket, "DealDisputed")
      .withArgs(id);

    expect((await escrowMarket.deals(id)).state).to.equal(STATE.Disputed);
  });

  it("resolveDispute: admin only resolve to seller or to buyer", async () => {
    const { escrowMarket, seller, buyer, other } = await deployEscrowMarketFixture();
    const price = parseEther("0.07");
    const id = await escrowMarket.connect(seller).list(price, "C").then(() => 1);
    await escrowMarket.connect(buyer).fund(id, { value: price });
    await escrowMarket.connect(buyer).openDispute(id);

    // not admin
    await expect(escrowMarket.connect(other).resolveDispute(id, true))
      .to.be.revertedWithCustomError(escrowMarket, "NotAdmin");

    // to seller
    await expect(escrowMarket.resolveDispute(id, true))
      .to.emit(escrowMarket, "DealResolved")
      .withArgs(id, true);
    expect(await escrowMarket.balances(seller.address)).to.equal(price);
    expect((await escrowMarket.deals(id)).state).to.equal(STATE.Completed);

    // new dispute for second case
    const id2 = await escrowMarket.connect(seller).list(price, "D").then(() => 2);
    await escrowMarket.connect(buyer).fund(id2, { value: price });
    await escrowMarket.connect(seller).openDispute(id2);

    await expect(escrowMarket.resolveDispute(id2, false))
      .to.emit(escrowMarket, "DealResolved")
      .withArgs(id2, false);
    expect(await escrowMarket.balances(buyer.address)).to.equal(price);
    expect((await escrowMarket.deals(id2)).state).to.equal(STATE.Cancelled);
  });

  // === withdraw ===
  it("withdraw: withdraws balance, zeros it out, and emits event", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("1");
    const id = await escrowMarket.connect(seller).list(price, "Phone").then(() => 1);
    await escrowMarket.connect(buyer).fund(id, { value: price });
    await escrowMarket.connect(seller).ship(id);
    await escrowMarket.connect(buyer).confirmReceived(id);

    // balance for seller
    expect(await escrowMarket.balances(seller.address)).to.equal(price);

    await expect(escrowMarket.connect(seller).withdraw())
      .to.emit(escrowMarket, "Withdrawal")
      .withArgs(seller.address, price);

    expect(await escrowMarket.balances(seller.address)).to.equal(0n);

    // no balance
    await expect(escrowMarket.connect(seller).withdraw())
      .to.be.revertedWithCustomError(escrowMarket, "NothingToWithdraw");
  });

  // === Admin controls (pause / freeze / ban) ===
  it("pause: blocks list/fund/ship/confirm/cancel/openDispute while paused", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.2");

    await escrowMarket.pause();

    await expect(escrowMarket.connect(seller).list(price, "P"))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");

    const id = 1; // not created yet; unpause then create
    await escrowMarket.unpause();
    await escrowMarket.connect(seller).list(price, "P"); // id=1
    await escrowMarket.pause();

    await expect(escrowMarket.connect(buyer).fund(1, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");
    await expect(escrowMarket.connect(seller).ship(1))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");
    await expect(escrowMarket.connect(buyer).confirmReceived(1))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");
    await expect(escrowMarket.connect(buyer).cancelBeforeShipment(1))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");
    await expect(escrowMarket.connect(buyer).openDispute(1))
      .to.be.revertedWithCustomError(escrowMarket, "Paused");

    await escrowMarket.unpause(); // cleanup
  });

  it("freeze: freezes a specific deal and blocks fund/ship/confirm/cancel only for it", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.15");
    const id = await escrowMarket.connect(seller).list(price, "F").then(() => 1);

    await expect(escrowMarket.freeze(999))
      .to.be.revertedWithCustomError(escrowMarket, "InvalidDeal")
      .withArgs(999);

    await expect(escrowMarket.freeze(id))
      .to.emit(escrowMarket, "DealFrozenSet")
      .withArgs(id, true);

    await expect(escrowMarket.connect(buyer).fund(id, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "DealFrozen")
      .withArgs(id);

    await expect(escrowMarket.unfreeze(id))
      .to.emit(escrowMarket, "DealFrozenSet")
      .withArgs(id, false);

    // now it works
    await escrowMarket.connect(buyer).fund(id, { value: price });
  });

  it("ban: prevents starting new deals only (list + fund) and emits event", async () => {
    const { escrowMarket, seller, buyer } = await deployEscrowMarketFixture();
    const price = parseEther("0.12");

    await expect(escrowMarket.setBanned(seller.address, true))
      .to.emit(escrowMarket, "BannedSet")
      .withArgs(seller.address, true);

    await expect(escrowMarket.connect(seller).list(price, "Z"))
      .to.be.revertedWithCustomError(escrowMarket, "Banned")
      .withArgs(seller.address);

    // Create from a non-banned address then ban the buyer --> fund is blocked
    await escrowMarket.setBanned(seller.address, false);
    const id = await escrowMarket.connect(seller).list(price, "Z").then(() => 1);

    await expect(escrowMarket.setBanned(buyer.address, true))
      .to.emit(escrowMarket, "BannedSet")
      .withArgs(buyer.address, true);

    await expect(escrowMarket.connect(buyer).fund(id, { value: price }))
      .to.be.revertedWithCustomError(escrowMarket, "Banned")
      .withArgs(buyer.address);

    // Ban does not block ship/confirm on existing deals (if already funded)
  });

  // === receive / fallback ===
  it("receive(): direct payment rejected with DirectPaymentRejected", async () => {
    const { escrowMarket, buyer } = await deployEscrowMarketFixture();
    await expect(
      buyer.sendTransaction({ to: await escrowMarket.getAddress(), value: parseEther("0.01") })
    ).to.be.revertedWithCustomError(escrowMarket, "DirectPaymentRejected");
  });

  it("fallback(): unknown calldata rejected with DirectPaymentRejected", async () => {
    const { escrowMarket, buyer } = await deployEscrowMarketFixture();
    await expect(
      buyer.sendTransaction({ to: await escrowMarket.getAddress(), data: "0x12345678" })
    ).to.be.revertedWithCustomError(escrowMarket, "DirectPaymentRejected");
  });
});
