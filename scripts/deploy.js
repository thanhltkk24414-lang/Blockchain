const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const network = hre.network.name;
  let usdcAddress = process.env.USDC_ADDRESS;

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

  return deployment;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
