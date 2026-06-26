/**
 * Grant delegated platform roles on Sepolia (admin = deployer / INDEXER wallet).
 *
 * Usage:
 *   npx hardhat run scripts/grant-platform-roles.js --network sepolia
 *
 * Env:
 *   GRANTEE_ADDRESS=0x...           (required)
 *   ROLE=arbitrator_manager|pauser|force_resolver  (default: arbitrator_manager)
 *   ARBITRATOR_PANEL=0x...
 *   ESCROW_VAULT=0x...
 *
 * Loads addresses from deployments/sepolia.json when env vars omitted.
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

function loadSepoliaAddresses() {
  const p = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).addresses || {};
  } catch {
    return {};
  }
}

async function main() {
  const grantee = process.env.GRANTEE_ADDRESS;
  if (!grantee) {
    throw new Error('Set GRANTEE_ADDRESS');
  }

  const addrs = loadSepoliaAddresses();
  const roleName = (process.env.ROLE || 'arbitrator_manager').toLowerCase();
  const [signer] = await hre.ethers.getSigners();
  console.log('Admin signer:', signer.address);
  console.log('Grantee:', grantee);
  console.log('Role:', roleName);

  if (roleName === 'arbitrator_manager') {
    const panelAddr = process.env.ARBITRATOR_PANEL || addrs.ArbitratorPanel;
    if (!panelAddr) throw new Error('ArbitratorPanel address missing');
    const panel = await hre.ethers.getContractAt('ArbitratorPanel', panelAddr);
    const role = await panel.ROLE_ARBITRATOR_MANAGER();
    const tx = await panel.grantRole(grantee, role);
    await tx.wait();
    console.log('Granted ROLE_ARBITRATOR_MANAGER on', panelAddr);
    return;
  }

  const vaultAddr = process.env.ESCROW_VAULT || addrs.EscrowVault;
  if (!vaultAddr) throw new Error('EscrowVault address missing');
  const vault = await hre.ethers.getContractAt('EscrowVault', vaultAddr);

  if (roleName === 'pauser') {
    const role = await vault.ROLE_PAUSER();
    const tx = await vault.grantRole(grantee, role);
    await tx.wait();
    console.log('Granted ROLE_PAUSER on', vaultAddr);
    return;
  }

  if (roleName === 'force_resolver') {
    const role = await vault.ROLE_FORCE_RESOLVER();
    const tx = await vault.grantRole(grantee, role);
    await tx.wait();
    console.log('Granted ROLE_FORCE_RESOLVER on', vaultAddr);
    return;
  }

  throw new Error(`Unknown ROLE: ${roleName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
