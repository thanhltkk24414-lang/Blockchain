const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const network = hre.network.name;
  if (network === "sepolia") {
    const timingsPath = path.join(__dirname, "..", "contracts", "DisputeTimings.sol");
    const timingsSrc = fs.readFileSync(timingsPath, "utf8");
    if (timingsSrc.includes("30 minutes") && timingsSrc.includes("60 minutes")) {
      console.log("Dispute timings: DEMO (short windows for live Sepolia demo)");
    } else {
      console.warn(
        "WARNING: DisputeTimings.sol looks like production (120h windows).",
        "Run: node scripts/prepare-dispute-timings.js demo"
      );
    }
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  let usdcAddress = process.env.USDC_ADDRESS;

  // Reuse existing MockUSDC on Sepolia redeploys so demo wallets keep balances.
  if (!usdcAddress && network === "sepolia") {
    const sepoliaPath = path.join(__dirname, "..", "deployments", "sepolia.json");
    if (fs.existsSync(sepoliaPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(sepoliaPath, "utf8"));
        if (prev.addresses?.MockUSDC) {
          usdcAddress = prev.addresses.MockUSDC;
          console.log("Reusing MockUSDC from prior sepolia.json:", usdcAddress);
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!usdcAddress) {
    console.log("USDC_ADDRESS not set — deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);
  } else {
    console.log("Using existing USDC at:", usdcAddress);
  }

  const ReputationStore = await hre.ethers.getContractFactory("ReputationStore");
  const reputation = await ReputationStore.deploy();
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log("ReputationStore:", reputationAddress);

  const PlatformTreasury = await hre.ethers.getContractFactory("PlatformTreasury");
  const treasury = await PlatformTreasury.deploy(usdcAddress);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("PlatformTreasury:", treasuryAddress);

  const JobRegistry = await hre.ethers.getContractFactory("JobRegistry");
  const registry = await JobRegistry.deploy(reputationAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("JobRegistry:", registryAddress);

  const ArbitratorPanel = await hre.ethers.getContractFactory("ArbitratorPanel");
  const panel = await ArbitratorPanel.deploy(
    reputationAddress,
    registryAddress,
    treasuryAddress
  );
  await panel.waitForDeployment();
  const panelAddress = await panel.getAddress();
  console.log("ArbitratorPanel:", panelAddress);

  const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
  const escrow = await EscrowVault.deploy(
    usdcAddress,
    registryAddress,
    treasuryAddress,
    panelAddress,
    reputationAddress
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("EscrowVault:", escrowAddress);

  for (const c of [reputation, registry, treasury, panel]) {
    await c.setAuthorizedContract(escrowAddress, true);
  }
  await reputation.setAuthorizedContract(panelAddress, true);
  await treasury.setAuthorizedContract(panelAddress, true);
  console.log("Authorization wired between contracts");
  console.log("Admin (all contracts):", deployer.address);
  console.log("Use transferAdmin() on each contract to rotate platform admin");
  console.log(
    "Optional delegated roles: EscrowVault.grantRole(addr, ROLE_PAUSER|ROLE_FORCE_RESOLVER),",
    "ArbitratorPanel.grantRole(addr, ROLE_ARBITRATOR_MANAGER)"
  );

  const deployment = {
    network,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    addresses: {
      MockUSDC: usdcAddress,
      ReputationStore: reputationAddress,
      PlatformTreasury: treasuryAddress,
      JobRegistry: registryAddress,
      ArbitratorPanel: panelAddress,
      EscrowVault: escrowAddress,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log("Deployment saved to", outFile);

  if (network === "sepolia") {
    const frontendFile = path.join(
      __dirname,
      "..",
      "frontend",
      "src",
      "lib",
      "contracts",
      "deployments-sepolia.json"
    );
    fs.writeFileSync(frontendFile, JSON.stringify(deployment, null, 2));
    console.log("Synced frontend deployments ->", path.relative(path.join(__dirname, ".."), frontendFile));
  }

  return deployment;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
