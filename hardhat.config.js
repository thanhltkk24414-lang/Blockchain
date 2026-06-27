require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
const { task } = require("hardhat/config");

// Prefer contracts/.env (project convention), fall back to root .env
require("dotenv").config({ path: path.join(__dirname, "contracts", ".env") });
require("dotenv").config();

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
};

/** After every `hardhat compile`, sync ABIs to backend + frontend (SC-6). */
task("compile").setAction(async (args, hre, runSuper) => {
  const result = await runSuper();
  if (process.env.SKIP_ABI_EXPORT === "1") {
    return result;
  }
  const { main: exportAbis } = require("./scripts/export-abis");
  exportAbis();
  return result;
});
