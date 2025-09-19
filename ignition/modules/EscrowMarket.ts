import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("EscrowModule", (m) => {
  const escrow = m.contract("EscrowMarket");
  return { escrow };
});
