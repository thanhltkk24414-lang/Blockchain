const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = (n) => BigInt(n) * 1_000_000n;
const BPS = (amount, bps) => (amount * BigInt(bps)) / 100n;

describe("FreelanceSystem", function () {
  let admin, client, freelancer, arb1, arb2, arb3, arb4, arb5, outsider;
  let usdc, reputation, treasury, registry, panel, escrow;

  async function deploySystem() {
    const signers = await ethers.getSigners();
    admin = signers[0];
    client = signers[1];
    freelancer = signers[2];
    arb1 = signers[3];
    arb2 = signers[4];
    arb3 = signers[5];
    arb4 = signers[6];
    arb5 = signers[7];
    outsider = signers[8];

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const ReputationStore = await ethers.getContractFactory("ReputationStore");
    reputation = await ReputationStore.deploy();

    const PlatformTreasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = await PlatformTreasury.deploy(await usdc.getAddress());

    const JobRegistry = await ethers.getContractFactory("JobRegistry");
    registry = await JobRegistry.deploy(await reputation.getAddress());

    const ArbitratorPanel = await ethers.getContractFactory("ArbitratorPanel");
    panel = await ArbitratorPanel.deploy(
      await reputation.getAddress(),
      await registry.getAddress(),
      await treasury.getAddress()
    );

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrow = await EscrowVault.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      await treasury.getAddress(),
      await panel.getAddress(),
      await reputation.getAddress()
    );

    const escrowAddr = await escrow.getAddress();
    const panelAddr = await panel.getAddress();

    for (const c of [reputation, registry, treasury, panel]) {
      await c.setAuthorizedContract(escrowAddr, true);
    }
    await reputation.setAuthorizedContract(panelAddr, true);
    await treasury.setAuthorizedContract(panelAddr, true);

    const fund = [client, freelancer, arb1, arb2, arb3, arb4, arb5, outsider];
    for (const acct of fund) {
      await usdc.mint(acct.address, USDC(100_000));
    }
  }

  async function createOpenJob(contractValue = USDC(500), duration = 30 * 24 * 3600) {
    await registry.connect(client).createJob("QmJobMeta", contractValue, duration);
    return 1n;
  }

  async function depositAndAssign(jobId = 1n) {
    const job = await registry.getJob(jobId);
    const total = job.contractValue + BPS(job.contractValue, 3);
    await usdc.connect(client).approve(await escrow.getAddress(), total);
    await escrow.connect(client).depositEscrow(jobId, freelancer.address);
  }

  async function setupArbitratorPool() {
    const stake = USDC(50);
    for (const arb of [arb1, arb2, arb3, arb4, arb5]) {
      await usdc.connect(arb).approve(await treasury.getAddress(), stake);
      await treasury.connect(arb).stakeAsArbitrator(stake);
      await panel.connect(arb).joinPool(arb.address);
    }
  }

  beforeEach(async function () {
    await deploySystem();
  });

  describe("JobRegistry", function () {
    it("creates job in OPEN status with metadata", async function () {
      const tx = await registry.connect(client).createJob("QmMeta", USDC(1000), 86400);
      await expect(tx).to.emit(registry, "JobCreated").withArgs(1, client.address, USDC(1000));

      const job = await registry.getJob(1);
      expect(job.client).to.equal(client.address);
      expect(job.status).to.equal(0); // OPEN
      expect(job.contractValue).to.equal(USDC(1000));
      expect(job.jobMetadataCID).to.equal("QmMeta");
    });

    it("accepts proposals from Normal tier freelancers", async function () {
      await createOpenJob();
      await registry.connect(freelancer).submitProposal(1, USDC(480), "QmProposal");
      const proposals = await registry.getProposals(1);
      expect(proposals.length).to.equal(1);
      expect(proposals[0].freelancer).to.equal(freelancer.address);
    });

    it("blocks proposals from Warning tier users", async function () {
      await reputation.updateScore(freelancer.address, false, 25); // 100 -> 75 = Warning
      await createOpenJob();
      await expect(
        registry.connect(freelancer).submitProposal(1, USDC(500), "QmProposal")
      ).to.be.revertedWithCustomError(registry, "LowReputationTier");
    });

    it("allows client to cancel OPEN job before escrow", async function () {
      await createOpenJob();
      await registry.connect(client).cancelOpenJob(1);
      const job = await registry.getJob(1);
      expect(job.status).to.equal(7); // CANCELLED
    });
  });

  describe("Escrow happy path", function () {
    it("deposits escrow, starts work, submits, and releases with correct fees", async function () {
      const contractValue = USDC(500);
      await createOpenJob(contractValue);
      await registry.connect(freelancer).submitProposal(1, contractValue, "QmBid");

      const platformFee = BPS(contractValue, 3);
      const totalDeposit = contractValue + platformFee;
      await usdc.connect(client).approve(await escrow.getAddress(), totalDeposit);
      await escrow.connect(client).depositEscrow(1, freelancer.address);

      let job = await registry.getJob(1);
      expect(job.status).to.equal(1); // ASSIGNED
      expect(job.freelancer).to.equal(freelancer.address);

      await escrow.connect(freelancer).startWork(1);
      job = await registry.getJob(1);
      expect(job.status).to.equal(2); // IN_PROGRESS

      await escrow.connect(freelancer).submitWork(1, "QmDeliverable");
      job = await registry.getJob(1);
      expect(job.status).to.equal(3); // SUBMITTED
      expect(job.deliverableCID).to.equal("QmDeliverable");

      const flBefore = await usdc.balanceOf(freelancer.address);
      const treasuryBefore = await treasury.totalPlatformFees();

      await escrow.connect(client).approveAndRelease(1);

      const serviceFee = BPS(contractValue, 2);
      const expectedNet = contractValue - serviceFee;
      expect(await usdc.balanceOf(freelancer.address)).to.equal(flBefore + expectedNet);

      const expectedRevenue = platformFee + serviceFee;
      expect(await treasury.totalPlatformFees()).to.equal(treasuryBefore + expectedRevenue);

      job = await registry.getJob(1);
      expect(job.status).to.equal(5); // COMPLETED
      expect(await reputation.getScore(freelancer.address)).to.equal(110);
      expect(await reputation.getScore(client.address)).to.equal(105);
    });

    it("auto-releases after 7-day review period", async function () {
      await createOpenJob(USDC(500));
      await depositAndAssign();
      await escrow.connect(freelancer).startWork(1);
      await escrow.connect(freelancer).submitWork(1, "QmDeliverable");

      await expect(escrow.claimTimeoutRelease(1)).to.be.revertedWithCustomError(
        escrow,
        "ReviewPeriodActive"
      );

      await time.increase(7 * 24 * 3600 + 1);
      await escrow.claimTimeoutRelease(1);

      const job = await registry.getJob(1);
      expect(job.status).to.equal(5); // COMPLETED
    });
  });

  describe("Contract cancellation", function () {
    it("refunds client if freelancer never starts within 72h", async function () {
      const contractValue = USDC(500);
      await createOpenJob(contractValue);
      await depositAndAssign();

      const clientBefore = await usdc.balanceOf(client.address);
      await time.increase(72 * 3600 + 1);

      await expect(escrow.connect(client).cancelContract(1))
        .to.emit(escrow, "ContractCancelled")
        .withArgs(1, client.address, contractValue + BPS(contractValue, 3));

      expect(await usdc.balanceOf(client.address)).to.equal(
        clientBefore + contractValue + BPS(contractValue, 3)
      );

      const job = await registry.getJob(1);
      expect(job.status).to.equal(7); // CANCELLED
    });

    it("blocks cancel before 72h window expires", async function () {
      await createOpenJob(USDC(500));
      await depositAndAssign();
      await expect(escrow.connect(client).cancelContract(1)).to.be.revertedWithCustomError(
        escrow,
        "StartWindowActive"
      );
    });

    it("blocks freelancer start after 72h", async function () {
      await createOpenJob(USDC(500));
      await depositAndAssign();
      await time.increase(72 * 3600 + 1);
      await expect(escrow.connect(freelancer).startWork(1)).to.be.revertedWithCustomError(
        escrow,
        "StartWindowExpired"
      );
    });
  });

  describe("Dispute resolution", function () {
    async function raiseDisputeFromSubmitted(initiator = client) {
      await createOpenJob(USDC(500));
      await depositAndAssign();
      await escrow.connect(freelancer).startWork(1);
      await escrow.connect(freelancer).submitWork(1, "QmDeliverable");
      await setupArbitratorPool();

      const fee = BPS(USDC(500), 2); // min(2%, 50 USDC) = 10 USDC
      await usdc.connect(initiator).approve(await escrow.getAddress(), fee);
      await escrow.connect(initiator).raiseDispute(1);
    }

    it("raises dispute, freezes escrow, and selects arbitrators", async function () {
      await raiseDisputeFromSubmitted();
      const job = await registry.getJob(1);
      expect(job.status).to.equal(4); // DISPUTED

      const arbs = await panel.getChosenArbitrators(1);
      expect(arbs.length).to.equal(5);
    });

    it("resolves dispute with freelancer win after voting", async function () {
      await raiseDisputeFromSubmitted(freelancer);

      const arbs = await panel.getChosenArbitrators(1);
      const createdAt = (await panel.disputes(1)).createdAt;

      await time.increaseTo(Number(createdAt) + 120 * 3600 + 1);

      const salt = "test-salt";
      const choice = 1; // FREELANCER_WIN
      for (const arb of arbs.slice(0, 3)) {
        const hash = ethers.solidityPackedKeccak256(
          ["uint256", "string"],
          [choice, salt]
        );
        await panel.connect(await ethers.getSigner(arb)).commitVote(1, hash);
      }

      await time.increaseTo(Number(createdAt) + 144 * 3600 + 1);

      for (const arb of arbs.slice(0, 3)) {
        await panel
          .connect(await ethers.getSigner(arb))
          .revealVote(1, choice, salt);
      }

      await time.increaseTo(Number(createdAt) + 168 * 3600 + 1);
      await escrow.finalizeDisputeVoting(1);

      await time.increase(72 * 3600 + 1);
      const flBefore = await usdc.balanceOf(freelancer.address);
      await escrow.executeArbitrationResult(1);

      const contractValue = USDC(500);
      const disputeFee = BPS(contractValue, 2);
      const expectedNet = contractValue - BPS(contractValue, 2) + disputeFee;
      expect(await usdc.balanceOf(freelancer.address)).to.equal(flBefore + expectedNet);

      const job = await registry.getJob(1);
      expect(job.status).to.equal(5); // COMPLETED
    });

    it("refunds client when arbitrators rule client win", async function () {
      await raiseDisputeFromSubmitted(client);

      const arbs = await panel.getChosenArbitrators(1);
      const createdAt = (await panel.disputes(1)).createdAt;
      const salt = "client-win";

      await time.increaseTo(Number(createdAt) + 120 * 3600 + 1);
      for (const arb of arbs.slice(0, 3)) {
        const hash = ethers.solidityPackedKeccak256(["uint256", "string"], [2, salt]);
        await panel.connect(await ethers.getSigner(arb)).commitVote(1, hash);
      }

      await time.increaseTo(Number(createdAt) + 144 * 3600 + 1);
      for (const arb of arbs.slice(0, 3)) {
        await panel.connect(await ethers.getSigner(arb)).revealVote(1, 2, salt);
      }

      await time.increaseTo(Number(createdAt) + 168 * 3600 + 1);
      await escrow.finalizeDisputeVoting(1);
      await time.increase(72 * 3600 + 1);

      const clientBefore = await usdc.balanceOf(client.address);
      await escrow.executeArbitrationResult(1);

      const contractValue = USDC(500);
      const disputeFee = BPS(contractValue, 2);
      expect(await usdc.balanceOf(client.address)).to.equal(
        clientBefore + contractValue + BPS(contractValue, 3) + disputeFee
      );

      const job = await registry.getJob(1);
      expect(job.status).to.equal(6); // REFUNDED
      expect(await reputation.getScore(freelancer.address)).to.equal(85);
    });
  });

  describe("Emergency pause", function () {
    it("blocks deposit and release while paused", async function () {
      await createOpenJob(USDC(500));
      await escrow.connect(admin).setPaused(true);

      const total = USDC(500) + BPS(USDC(500), 3);
      await usdc.connect(client).approve(await escrow.getAddress(), total);
      await expect(
        escrow.connect(client).depositEscrow(1, freelancer.address)
      ).to.be.revertedWithCustomError(escrow, "ContractPaused");

      await escrow.connect(admin).setPaused(false);
      await escrow.connect(client).depositEscrow(1, freelancer.address);
      await escrow.connect(freelancer).startWork(1);
      await escrow.connect(freelancer).submitWork(1, "QmX");

      await escrow.connect(admin).setPaused(true);
      await expect(escrow.connect(client).approveAndRelease(1)).to.be.revertedWithCustomError(
        escrow,
        "ContractPaused"
      );

      // startWork still allowed while paused (per terms)
      await escrow.connect(admin).setPaused(false);
    });
  });

  describe("PlatformTreasury", function () {
    it("requires minimum stake and tracks active disputes on unstake", async function () {
      await usdc.connect(arb1).approve(await treasury.getAddress(), USDC(50));
      await treasury.connect(arb1).stakeAsArbitrator(USDC(50));

      await expect(treasury.connect(arb1).stakeAsArbitrator(USDC(10))).to.be.revertedWithCustomError(
        treasury,
        "InsufficientStake"
      );

      await treasury.connect(admin).incrementActiveDispute(arb1.address);
      await expect(treasury.connect(arb1).unstakeAsArbitrator(USDC(50))).to.be.revertedWithCustomError(
        treasury,
        "StillActiveInDispute"
      );
    });
  });

  describe("ReputationStore", function () {
    it("defaults new users to score 100 and correct tiers", async function () {
      expect(await reputation.getScore(outsider.address)).to.equal(100);
      expect(await reputation.getTier(outsider.address)).to.equal(2); // Normal

      await reputation.updateScore(outsider.address, true, 25);
      expect(await reputation.getTier(outsider.address)).to.equal(3); // Trusted
    });
  });

  describe("Admin role management", function () {
    it("transfers admin and revokes old admin privileges", async function () {
      await expect(reputation.connect(admin).transferAdmin(outsider.address))
        .to.emit(reputation, "AdminTransferred")
        .withArgs(admin.address, outsider.address);

      expect(await reputation.admin()).to.equal(outsider.address);

      await expect(
        reputation.connect(admin).setAuthorizedContract(outsider.address, true)
      ).to.be.revertedWithCustomError(reputation, "OnlyAdmin");

      await reputation.connect(outsider).setAuthorizedContract(outsider.address, true);
      expect(await reputation.authorizedContracts(outsider.address)).to.equal(true);
    });

    it("rejects zero-address admin transfer", async function () {
      await expect(
        reputation.connect(admin).transferAdmin(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(reputation, "InvalidAdminAddress");
    });

    it("blocks non-admin from transferAdmin and setPaused", async function () {
      await expect(
        escrow.connect(outsider).transferAdmin(outsider.address)
      ).to.be.revertedWithCustomError(escrow, "OnlyAdmin");

      await expect(
        escrow.connect(outsider).setPaused(true)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("allows new admin to pause escrow after transfer", async function () {
      await escrow.connect(admin).transferAdmin(outsider.address);
      await escrow.connect(outsider).setPaused(true);
      expect(await escrow.paused()).to.equal(true);
    });
  });

  describe("Delegated roles", function () {
    const ROLE_PAUSER = 1n;
    const ROLE_FORCE_RESOLVER = 2n;
    const ROLE_ARBITRATOR_MANAGER = 1n;

    it("grants pauser without full admin and revokes access", async function () {
      await escrow.connect(admin).grantRole(outsider.address, ROLE_PAUSER);
      expect(await escrow.hasRole(outsider.address, ROLE_PAUSER)).to.equal(true);

      await escrow.connect(outsider).setPaused(true);
      expect(await escrow.paused()).to.equal(true);

      await escrow.connect(admin).revokeRole(outsider.address, ROLE_PAUSER);
      await expect(
        escrow.connect(outsider).setPaused(false)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("blocks delegated pauser from transferAdmin and grantRole", async function () {
      await escrow.connect(admin).grantRole(outsider.address, ROLE_PAUSER);

      await expect(
        escrow.connect(outsider).transferAdmin(outsider.address)
      ).to.be.revertedWithCustomError(escrow, "OnlyAdmin");

      await expect(
        escrow.connect(outsider).grantRole(outsider.address, ROLE_PAUSER)
      ).to.be.revertedWithCustomError(escrow, "OnlyAdmin");
    });

    it("allows arbitrator manager to joinPool for others", async function () {
      await usdc.connect(arb1).approve(await treasury.getAddress(), USDC(50));
      await treasury.connect(arb1).stakeAsArbitrator(USDC(50));

      await panel.connect(admin).grantRole(outsider.address, ROLE_ARBITRATOR_MANAGER);
      await expect(panel.connect(outsider).joinPool(arb1.address)).to.emit(
        panel,
        "ArbitratorJoined"
      );
      expect(await panel.isInPool(arb1.address)).to.equal(true);
    });

    it("blocks non-manager from joining pool on behalf of others", async function () {
      await usdc.connect(arb1).approve(await treasury.getAddress(), USDC(50));
      await treasury.connect(arb1).stakeAsArbitrator(USDC(50));

      await expect(panel.connect(outsider).joinPool(arb1.address)).to.be.revertedWithCustomError(
        panel,
        "Unauthorized"
      );
    });

    it("allows force resolver role without pauser privileges", async function () {
      await createOpenJob(USDC(500));
      await depositAndAssign();
      await escrow.connect(freelancer).startWork(1);
      await escrow.connect(freelancer).submitWork(1, "QmX");
      await setupArbitratorPool();

      const fee = BPS(USDC(500), 2);
      await usdc.connect(client).approve(await escrow.getAddress(), fee);
      await escrow.connect(client).raiseDispute(1);

      await escrow.connect(admin).grantRole(outsider.address, ROLE_FORCE_RESOLVER);

      await expect(
        escrow.connect(outsider).setPaused(true)
      ).to.be.revertedWithCustomError(escrow, "Unauthorized");

      // Quorum fail path — adminForceResolve still callable by force resolver
      const createdAt = (await panel.disputes(1)).createdAt;
      await time.increaseTo(Number(createdAt) + 168 * 3600 + 1);
      await expect(escrow.finalizeDisputeVoting(1)).to.be.revertedWithCustomError(
        panel,
        "InsufficientQuorum"
      );

      await escrow.connect(outsider).adminForceResolve(1, 1); // FREELANCER_WIN
      expect((await registry.getJob(1)).status).to.equal(5); // COMPLETED
    });
  });
});
