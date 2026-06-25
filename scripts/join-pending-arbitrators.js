/**
 * Self-join arbitrators that are staked but not yet in pool (deployer out of Sepolia ETH).
 * Reads private keys from deployments/sepolia-arbitrators.json (gitignored).
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  const keysPath = path.join(__dirname, '..', 'deployments', 'sepolia-arbitrators.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const keysFile = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  const panelAddr = deployment.addresses.ArbitratorPanel;
  const panel = await hre.ethers.getContractAt('ArbitratorPanel', panelAddr);

  for (const entry of keysFile.arbitrators || []) {
    if (!entry.privateKey) continue;
    const wallet = new hre.ethers.Wallet(entry.privateKey, hre.ethers.provider);
    if (wallet.address.toLowerCase() !== entry.address.toLowerCase()) {
      throw new Error(`Key/address mismatch for ${entry.address}`);
    }
    const inPool = await panel.isInPool(wallet.address);
    if (inPool) {
      console.log('Already in pool:', wallet.address);
      continue;
    }
    console.log('Self-join:', wallet.address);
    const panelArb = panel.connect(wallet);
    const tx = await panelArb.joinPool(wallet.address);
    await tx.wait(2);
    entry.status = 'joined';
    console.log('Joined:', wallet.address);
  }

  fs.writeFileSync(keysPath, JSON.stringify(keysFile, null, 2));
  console.log('poolSize:', await panel.poolSize());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
