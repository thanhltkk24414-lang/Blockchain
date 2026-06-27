/**
 * Export contract ABIs from Hardhat artifacts to backend/src/abi/.
 * Run from repo root: npm run export-abis
 */
const fs = require("fs");
const path = require("path");

const CONTRACTS = [
  {
    name: "ReputationStore",
    artifact: "artifacts/contracts/FreelanceSystem.sol/ReputationStore.json",
  },
  {
    name: "PlatformTreasury",
    artifact: "artifacts/contracts/FreelanceSystem.sol/PlatformTreasury.json",
  },
  {
    name: "JobRegistry",
    artifact: "artifacts/contracts/FreelanceSystem.sol/JobRegistry.json",
  },
  {
    name: "ArbitratorPanel",
    artifact: "artifacts/contracts/FreelanceSystem.sol/ArbitratorPanel.json",
  },
  {
    name: "EscrowVault",
    artifact: "artifacts/contracts/FreelanceSystem.sol/EscrowVault.json",
  },
  {
    name: "MockUSDC",
    artifact: "artifacts/contracts/MockUSDC.sol/MockUSDC.json",
  },
];

const root = path.join(__dirname, "..");
const outDirs = [
  path.join(root, "backend", "src", "abi"),
  path.join(root, "frontend", "src", "lib", "contracts", "abis"),
];

function main() {
  for (const outDir of outDirs) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let exported = 0;
  for (const { name, artifact } of CONTRACTS) {
    const artifactPath = path.join(root, artifact);
    if (!fs.existsSync(artifactPath)) {
      console.error(`Missing artifact: ${artifactPath}`);
      console.error("Run `npm run compile` first.");
      process.exitCode = 1;
      return;
    }

    const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (!Array.isArray(abi) || abi.length === 0) {
      console.error(`Empty ABI for ${name}`);
      process.exitCode = 1;
      return;
    }

    const abiJson = JSON.stringify(abi, null, 2);
    for (const outDir of outDirs) {
      const outFile = path.join(outDir, `${name}.json`);
      fs.writeFileSync(outFile, abiJson);
      console.log(`Exported ${name}: ${abi.length} entries -> ${path.relative(root, outFile)}`);
    }
    exported++;
  }

  const deploySrc = path.join(root, "deployments", "sepolia.json");
  const deployDest = path.join(root, "frontend", "src", "lib", "contracts", "deployments-sepolia.json");
  if (fs.existsSync(deploySrc)) {
    fs.copyFileSync(deploySrc, deployDest);
    console.log(`Copied deployments/sepolia.json -> ${path.relative(root, deployDest)}`);
  }

  console.log(`Done. Exported ${exported} ABI file(s) to backend + frontend.`);
}

module.exports = { main };

if (require.main === module) {
  main();
}
