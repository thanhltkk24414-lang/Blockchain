/**
 * Seed ArbitratorPanel pool on Sepolia (≥5 members for raiseDispute sortition).
 *
 * Usage: npx hardhat run scripts/seed-arbitrator-pool.js --network sepolia
 *
 * Each arbitrator: mint 50 USDC → stakeAsArbitrator → admin joinPool.
 * Wallets are deterministically derived; keys saved to deployments/sepolia-arbitrators.json (gitignored).
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const USDC = (n) => BigInt(n) * 1_000_000n;
const STAKE = USDC(50);
const TARGET_POOL = 5;

async function deriveArbitratorWallets(count) {
  const wallets = [];
  while (wallets.length < count) {
    const wallet = hre.ethers.Wallet.createRandom();
    const code = await hre.ethers.provider.getCode(wallet.address);
    if (code === '0x') {
      wallets.push(wallet);
      console.log(`Derived EOA #${wallets.length}: ${wallet.address}`);
    }
  }
  return wallets;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'sepolia.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const { MockUSDC, PlatformTreasury, ArbitratorPanel } = deployment.addresses;

  const panel = await hre.ethers.getContractAt('ArbitratorPanel', ArbitratorPanel);
  const usdc = await hre.ethers.getContractAt('MockUSDC', MockUSDC);
  const treasury = await hre.ethers.getContractAt('PlatformTreasury', PlatformTreasury);

  const poolSizeBefore = Number(await panel.poolSize());
  console.log('Deployer (admin):', deployer.address);
  console.log('ArbitratorPanel:', ArbitratorPanel);
  console.log('poolSize before:', poolSizeBefore);

  if (poolSizeBefore >= TARGET_POOL) {
    console.log(`Pool already has ${poolSizeBefore} arbitrators — nothing to do.`);
    return;
  }

  const needed = TARGET_POOL - poolSizeBefore;
  const wallets = await deriveArbitratorWallets(needed);
  const out = {
    network: 'sepolia',
    seededAt: new Date().toISOString(),
    admin: deployer.address,
    arbitrators: [],
  };

  for (const wallet of wallets) {
    const addr = wallet.address;
    const arbSigner = wallet.connect(hre.ethers.provider);
    const inPool = await panel.isInPool(addr);
    if (inPool) {
      console.log(`Skip ${addr} — already in pool`);
      out.arbitrators.push({ address: addr, status: 'already_in_pool' });
      continue;
    }

    const stake = await treasury.arbitratorStakes(addr);
    if (stake < STAKE) {
      console.log(`Minting USDC for ${addr}...`);
      const mintTx = await usdc.mint(addr, USDC(100));
      await mintTx.wait(2);
      console.log(`Minted for ${addr}`);

      const usdcArb = usdc.connect(arbSigner);
      const treasuryArb = treasury.connect(arbSigner);

      const bal = await hre.ethers.provider.getBalance(addr);
      if (bal < hre.ethers.parseEther('0.0003')) {
        const fundTx = await deployer.sendTransaction({
          to: addr,
          value: hre.ethers.parseEther('0.001'),
        });
        const fundRcpt = await fundTx.wait(2);
        if (!fundRcpt) throw new Error(`ETH fund failed for ${addr}`);
        const balAfter = await hre.ethers.provider.getBalance(addr);
        console.log(`Funded ${addr} — balance ${hre.ethers.formatEther(balAfter)} ETH`);
        if (balAfter < hre.ethers.parseEther('0.0002')) {
          throw new Error(`Insufficient ETH on ${addr} after fund`);
        }
      }

      console.log(`Staking for ${addr}...`);
      const approveTx = await usdcArb.approve(PlatformTreasury, STAKE);
      await approveTx.wait(2);
      const stakeTx = await treasuryArb.stakeAsArbitrator(STAKE);
      await stakeTx.wait(2);
      console.log(`Staked 50 USDC for ${addr}`);
    }

    console.log(`joinPool ${addr}...`);
    const joinTx = await panel.joinPool(addr);
    await joinTx.wait(2);
    console.log(`joinPool OK: ${addr}`);

    out.arbitrators.push({
      address: addr,
      privateKey: wallet.privateKey,
      status: 'joined',
    });
  }

  const poolSizeAfter = Number(await panel.poolSize());
  console.log('poolSize after:', poolSizeAfter);

  const outPath = path.join(__dirname, '..', 'deployments', 'sepolia-arbitrators.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Saved arbitrator keys to', outPath, '(gitignored — import one key into MetaMask to vote)');

  if (poolSizeAfter < TARGET_POOL) {
    throw new Error(`Pool size ${poolSizeAfter} < ${TARGET_POOL} — check client/freelancer exclusion or stake failures`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
