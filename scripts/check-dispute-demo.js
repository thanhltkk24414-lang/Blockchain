/******
 * Read Sepolia on-chain state for dispute demo (pool + job status).
 * Usage: node scripts/check-dispute-demo.js [jobId]
**** */
const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', 'contracts', '.env') });

const JOB_ID = Number(process.argv[2] || 5);
const deployment = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'deployments', 'sepolia.json'), 'utf8'),
);

const RPC = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/2391dc7d6859472ab05d34a9890ba973';
const STATUS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'CANCELLED'];

const registryAbi = [
  'function getJob(uint256) view returns (tuple(address client,uint8 status,address freelancer,uint256 contractValue,uint256 deadline,uint256 submittedAt,uint256 assignedAt,string jobMetadataCID,string deliverableCID))',
];
const panelAbi = [
  'function poolSize() view returns (uint256)',
  'function getChosenArbitrators(uint256 jobId) view returns (address[])',
  'function disputes(uint256) view returns (address initiator,uint40 createdAt,bool isResolved,uint8 round,uint8 pendingResult,uint40 resultAt,uint8 commitCount,uint8 revealCount)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const registry = new ethers.Contract(deployment.addresses.JobRegistry, registryAbi, provider);
  const panel = new ethers.Contract(deployment.addresses.ArbitratorPanel, panelAbi, provider);

  const poolSize = Number(await panel.poolSize());
  console.log('ArbitratorPanel.poolSize:', poolSize);
  if (poolSize < 5) {
    console.warn('WARN: poolSize < 5 — raiseDispute will revert NotEnoughArbitrators');
  } else if (poolSize < 10) {
    console.warn('WARN: poolSize < 10 — fileAppeal / round 2 may revert NotEnoughArbitrators');
  }

  const raw = await registry.getJob(JOB_ID);
  console.log(`\nJob #${JOB_ID}:`);
  console.log('  status:', STATUS[Number(raw.status)] ?? raw.status);
  console.log('  client:', raw.client);
  console.log('  freelancer:', raw.freelancer);
  console.log('  contractValue (micro):', raw.contractValue.toString());
  console.log('  deliverableCID:', raw.deliverableCID || '(empty)');

  try {
    const d = await panel.disputes(JOB_ID);
    if (d.createdAt > 0n) {
      console.log('\nDispute panel:');
      console.log('  initiator:', d.initiator);
      console.log('  createdAt:', new Date(Number(d.createdAt) * 1000).toISOString());
      console.log('  round:', Number(d.round));
      console.log('  isResolved:', d.isResolved);
      const arbs = await panel.getChosenArbitrators(JOB_ID);
      console.log('  chosen arbitrators:', arbs);
    }
  } catch {
    /* no dispute */
  }
}

main().catch(console.error);
