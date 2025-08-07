/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // Needed for tests
  networks: {
    hardhat: {
      accounts: {
        count: 1,
      },
    },
  },
};
