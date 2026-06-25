/**
 * Select dispute phase timings before compile/deploy.
 *
 * Usage:
 *   node scripts/prepare-dispute-timings.js prod   # default — hardhat test / mainnet
 *   node scripts/prepare-dispute-timings.js demo   # Sepolia live demo
 */
const fs = require('fs');
const path = require('path');

const mode = (process.argv[2] || 'prod').toLowerCase();
const valid = ['prod', 'demo'];
if (!valid.includes(mode)) {
  console.error(`Unknown mode "${mode}". Use: ${valid.join(' | ')}`);
  process.exit(1);
}

const root = path.join(__dirname, '..');
const src = path.join(root, 'contracts', 'config', `DisputeTimings.${mode}.sol`);
const dest = path.join(root, 'contracts', 'DisputeTimings.sol');

if (!fs.existsSync(src)) {
  console.error(`Missing timings file: ${src}`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`DisputeTimings: ${mode} -> contracts/DisputeTimings.sol`);
