/** @type {import("hardhat/config").HardhatUserConfig} */
const chainId = Number(process.env.HARDHAT_TEST_CHAIN_ID ?? 31337);
const miningInterval = process.env.HARDHAT_TEST_MINING_INTERVAL
  ? Number(process.env.HARDHAT_TEST_MINING_INTERVAL)
  : undefined;

const localNetwork = {
  type: "edr-simulated",
  chainType: "l1",
  chainId,
  accounts: { count: 1 },
};

if (miningInterval !== undefined) {
  localNetwork.mining = { auto: false, interval: miningInterval };
}

export default {
  networks: {
    local: localNetwork,
  },
};
