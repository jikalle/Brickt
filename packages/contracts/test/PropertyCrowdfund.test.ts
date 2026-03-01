import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const ONE_USDC = 1_000_000n;

describe("PropertyCrowdfund", function () {
  async function expectRevert(promise: Promise<unknown>, message?: string) {
    try {
      await promise;
    } catch (error) {
      if (message) {
        const reason = (error as Error).message;
        expect(reason).to.include(message);
      }
      return;
    }

    expect.fail("Expected transaction to revert");
  }

  async function deployFixture() {
    const [admin, investor1, investor2, recipient] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const equity = await MockERC20.deploy("Equity Token", "EQT", 18);

    const now = await time.latest();
    const startTime = now - 10;
    const endTime = now + 1000;
    const targetAmount = 3n * ONE_USDC;
    const totalEquityTokens = ethers.parseUnits("1000", 18);

    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      usdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokens,
      "PROP-1"
    );

    await usdc.mint(investor1.address, 10n * ONE_USDC);
    await usdc.mint(investor2.address, 10n * ONE_USDC);

    return {
      admin,
      investor1,
      investor2,
      recipient,
      usdc,
      equity,
      crowdfund,
      targetAmount,
      totalEquityTokens,
      endTime,
    };
  }

  async function deployWithSchedule(startOffset: number, endOffset: number) {
    const [admin, investor1, investor2, recipient] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const equity = await MockERC20.deploy("Equity Token", "EQT", 18);

    const now = await time.latest();
    const startTime = now + startOffset;
    const endTime = now + endOffset;
    const targetAmount = 3n * ONE_USDC;
    const totalEquityTokens = ethers.parseUnits("1000", 18);

    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      usdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokens,
      "PROP-1"
    );

    await usdc.mint(investor1.address, 10n * ONE_USDC);
    await usdc.mint(investor2.address, 10n * ONE_USDC);

    return {
      admin,
      investor1,
      investor2,
      recipient,
      usdc,
      equity,
      crowdfund,
      targetAmount,
      totalEquityTokens,
      startTime,
      endTime,
    };
  }

  async function setupSuccessfulCampaignAndEquity({
    totalEquityTokensForSale,
    investorContributionsUSDC,
    initialHolderMode = "crowdfund",
  }: {
    totalEquityTokensForSale: bigint;
    investorContributionsUSDC: { signer: Awaited<ReturnType<typeof ethers.getSigners>>[number]; amount: bigint }[];
    initialHolderMode?: "crowdfund" | "admin";
  }) {
    const [admin] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const now = await time.latest();
    const startTime = now - 10;
    const endTime = now + 1000;

    const targetAmount = investorContributionsUSDC.reduce((sum, entry) => sum + entry.amount, 0n);
    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      usdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokensForSale,
      "PROP-1"
    );

    for (const { signer, amount } of investorContributionsUSDC) {
      await usdc.mint(signer.address, amount);
      await usdc.connect(signer).approve(crowdfund.target, amount);
      await crowdfund.connect(signer).invest(amount);
    }

    await crowdfund.finalizeCampaign();

    const EquityToken = await ethers.getContractFactory("EquityToken");
    const initialHolder =
      initialHolderMode === "crowdfund" ? crowdfund.target : admin.address;
    const equityToken = await EquityToken.deploy(
      "Equity Token",
      "EQT",
      "PROP-1",
      admin.address,
      initialHolder,
      totalEquityTokensForSale
    );

    if (initialHolderMode === "admin") {
      await equityToken.connect(admin).transfer(crowdfund.target, totalEquityTokensForSale);
    }

    await crowdfund.connect(admin).setEquityToken(equityToken.target);

    return { admin, usdc, crowdfund, equityToken, investors: investorContributionsUSDC.map((i) => i.signer) };
  }

  it("records investments and raised amount", async function () {
    const { investor1, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 2n * ONE_USDC);
    await crowdfund.connect(investor1).invest(2n * ONE_USDC);

    expect(await crowdfund.raisedAmountUSDC()).to.equal(2n * ONE_USDC);
    expect(await crowdfund.contributionOf(investor1.address)).to.equal(2n * ONE_USDC);
  });

  it("finalizes as failed and refunds investors", async function () {
    const { investor1, usdc, crowdfund, endTime } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(ONE_USDC);

    await time.increaseTo(endTime + 1);
    await crowdfund.finalizeCampaign();

    const balanceBefore = await usdc.balanceOf(investor1.address);
    await crowdfund.connect(investor1).claimRefund();
    const balanceAfter = await usdc.balanceOf(investor1.address);

    expect(balanceAfter - balanceBefore).to.equal(ONE_USDC);
    expect(await crowdfund.contributionOf(investor1.address)).to.equal(0n);
  });

  it("finalizes as success and allows withdraw only once", async function () {
    const { admin, investor1, investor2, recipient, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 3n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, 2n * ONE_USDC);
    await crowdfund.connect(investor1).invest(3n * ONE_USDC);
    await crowdfund.connect(investor2).invest(2n * ONE_USDC);

    await crowdfund.finalizeCampaign();

    await crowdfund.connect(admin).withdrawFunds(recipient.address);
    await expectRevert(
      crowdfund.connect(admin).withdrawFunds(recipient.address),
      "Campaign not successful"
    );
  });

  it("applies configured platform fee during withdraw", async function () {
    const { admin, investor1, investor2, recipient, usdc, crowdfund } = await deployFixture();
    const [, , , , feeRecipient] = await ethers.getSigners();

    await usdc.connect(investor1).approve(crowdfund.target, 3n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, 2n * ONE_USDC);
    await crowdfund.connect(investor1).invest(3n * ONE_USDC);
    await crowdfund.connect(investor2).invest(2n * ONE_USDC);
    await crowdfund.connect(admin).setPlatformFee(500, feeRecipient.address); // 5%
    await crowdfund.finalizeCampaign();

    const recipientBefore = await usdc.balanceOf(recipient.address);
    const feeBefore = await usdc.balanceOf(feeRecipient.address);

    await crowdfund.connect(admin).withdrawFunds(recipient.address);

    const recipientAfter = await usdc.balanceOf(recipient.address);
    const feeAfter = await usdc.balanceOf(feeRecipient.address);

    const totalRaised = 5n * ONE_USDC;
    const expectedFee = (totalRaised * 500n) / 10_000n;
    const expectedRecipient = totalRaised - expectedFee;

    expect(recipientAfter - recipientBefore).to.equal(expectedRecipient);
    expect(feeAfter - feeBefore).to.equal(expectedFee);
  });

  it("reverts platform fee config when fee exceeds max", async function () {
    const { admin, crowdfund } = await deployFixture();

    await expectRevert(
      crowdfund.connect(admin).setPlatformFee(2001, admin.address),
      "Fee too high"
    );
  });

  it("reverts platform fee config with zero recipient when fee > 0", async function () {
    const { admin, crowdfund } = await deployFixture();

    await expectRevert(
      crowdfund.connect(admin).setPlatformFee(100, ethers.ZeroAddress),
      "Invalid fee recipient"
    );
  });

  it("claims equity tokens pro-rata with rounding", async function () {
    const [investor1, investor2] = (await ethers.getSigners()).slice(1, 3);
    const totalEquityTokensForSale = ethers.parseUnits("1000", 18);
    const { crowdfund, equityToken } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale,
      investorContributionsUSDC: [
        { signer: investor1, amount: ONE_USDC },
        { signer: investor2, amount: 2n * ONE_USDC },
      ],
    });

    const totalRaised = await crowdfund.raisedAmountUSDC();
    const expectedInvestor1 = (totalEquityTokensForSale * ONE_USDC) / totalRaised;
    const expectedInvestor2 = (totalEquityTokensForSale * (2n * ONE_USDC)) / totalRaised;

    await crowdfund.connect(investor1).claimTokens();
    await crowdfund.connect(investor2).claimTokens();

    expect(await equityToken.balanceOf(investor1.address)).to.equal(expectedInvestor1);
    expect(await equityToken.balanceOf(investor2.address)).to.equal(expectedInvestor2);
    expect(expectedInvestor1 + expectedInvestor2 <= totalEquityTokensForSale).to.equal(true);
  });

  it("reverts invest before start time", async function () {
    const { investor1, usdc, crowdfund } = await deployWithSchedule(3600, 7200);

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await expectRevert(crowdfund.connect(investor1).invest(ONE_USDC), "NOT_STARTED");
  });

  it("allows invest once start time is reached", async function () {
    const { investor1, usdc, crowdfund, startTime } = await deployWithSchedule(3600, 7200);

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await time.increaseTo(startTime + 1);
    await crowdfund.connect(investor1).invest(ONE_USDC);

    expect(await crowdfund.raisedAmountUSDC()).to.equal(ONE_USDC);
  });

  it("reverts invest after end time", async function () {
    const { investor1, usdc, crowdfund, endTime } = await deployWithSchedule(-10, 100);

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await time.increaseTo(endTime + 1);
    await expectRevert(crowdfund.connect(investor1).invest(ONE_USDC), "Campaign ended");
  });

  it("reverts invest after finalize", async function () {
    const { investor1, investor2, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 2n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(2n * ONE_USDC);
    await crowdfund.connect(investor2).invest(ONE_USDC);

    await crowdfund.finalizeCampaign();

    await expectRevert(crowdfund.connect(investor1).invest(ONE_USDC), "Campaign not active");
  });

  it("reverts finalize before end time if target not met", async function () {
    const { investor1, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(ONE_USDC);

    await expectRevert(crowdfund.finalizeCampaign(), "Cannot finalize yet");
  });

  it("reverts finalize when called twice", async function () {
    const { investor1, investor2, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 2n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(2n * ONE_USDC);
    await crowdfund.connect(investor2).invest(ONE_USDC);

    await crowdfund.finalizeCampaign();
    await expectRevert(crowdfund.finalizeCampaign(), "Campaign not active");
  });

  it("reverts withdraw when called by non-admin", async function () {
    const { investor1, investor2, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 2n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(2n * ONE_USDC);
    await crowdfund.connect(investor2).invest(ONE_USDC);
    await crowdfund.finalizeCampaign();

    await expectRevert(
      crowdfund.connect(investor1).withdrawFunds(investor1.address),
      "OwnableUnauthorizedAccount"
    );
  });

  it("reverts setEquityToken when called by non-admin", async function () {
    const { investor1, equity, crowdfund } = await deployFixture();

    await expectRevert(
      crowdfund.connect(investor1).setEquityToken(equity.target),
      "OwnableUnauthorizedAccount"
    );
  });

  it("reverts setEquityToken when called twice", async function () {
    const [investor1, investor2] = (await ethers.getSigners()).slice(1, 3);
    const totalEquityTokensForSale = ethers.parseUnits("1000", 18);
    const { admin, crowdfund, equityToken } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale,
      investorContributionsUSDC: [
        { signer: investor1, amount: ONE_USDC },
        { signer: investor2, amount: 2n * ONE_USDC },
      ],
    });

    await expectRevert(
      crowdfund.connect(admin).setEquityToken(equityToken.target),
      "Equity token already set"
    );
  });

  it("requires equity token balance before setting equity token", async function () {
    const [admin, investor1, investor2, investor3] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const EquityToken = await ethers.getContractFactory("EquityToken");

    const now = await time.latest();
    const startTime = now - 10;
    const endTime = now + 1000;
    const targetAmount = 3n * ONE_USDC;
    const totalEquityTokens = ethers.parseUnits("100", 18);

    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      usdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokens,
      "PROP-1"
    );

    await usdc.mint(investor1.address, 10n * ONE_USDC);
    await usdc.mint(investor2.address, 10n * ONE_USDC);
    await usdc.mint(investor3.address, 10n * ONE_USDC);

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, ONE_USDC);
    await usdc.connect(investor3).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(ONE_USDC);
    await crowdfund.connect(investor2).invest(ONE_USDC);
    await crowdfund.connect(investor3).invest(ONE_USDC);

    await crowdfund.finalizeCampaign();

    const equity = await EquityToken.deploy(
      "Equity Token",
      "EQT",
      "PROP-1",
      admin.address,
      admin.address,
      totalEquityTokens
    );

    await expectRevert(
      crowdfund.connect(admin).setEquityToken(equity.target),
      "INSUFFICIENT_EQUITY_BALANCE"
    );

    await equity.connect(admin).transfer(crowdfund.target, totalEquityTokens);
    await crowdfund.connect(admin).setEquityToken(equity.target);

    await crowdfund.connect(investor1).claimTokens();
    await crowdfund.connect(investor2).claimTokens();
    await crowdfund.connect(investor3).claimTokens();
  });

  it("reverts withdraw when campaign not successful", async function () {
    const { admin, crowdfund } = await deployFixture();

    await expectRevert(
      crowdfund.connect(admin).withdrawFunds(admin.address),
      "Campaign not successful"
    );
  });

  it("reverts claimRefund when campaign not failed", async function () {
    const { investor1, crowdfund } = await deployFixture();

    await expectRevert(crowdfund.connect(investor1).claimRefund(), "Campaign not failed");
  });

  it("reverts claimRefund when no contribution exists", async function () {
    const { investor1, investor2, usdc, crowdfund, endTime } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(ONE_USDC);
    await time.increaseTo(endTime + 1);
    await crowdfund.finalizeCampaign();

    await expectRevert(crowdfund.connect(investor2).claimRefund(), "No refund available");
  });

  it("reverts claimTokens when equity token not set", async function () {
    const { investor1, investor2, usdc, crowdfund } = await deployFixture();

    await usdc.connect(investor1).approve(crowdfund.target, 2n * ONE_USDC);
    await usdc.connect(investor2).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(2n * ONE_USDC);
    await crowdfund.connect(investor2).invest(ONE_USDC);
    await crowdfund.finalizeCampaign();

    await expectRevert(crowdfund.connect(investor1).claimTokens(), "Equity token not set");
  });

  it("reverts claimTokens when contributor has no allocation", async function () {
    const [investor1, investor2] = (await ethers.getSigners()).slice(1, 3);
    const totalEquityTokensForSale = ethers.parseUnits("1000", 18);
    const { crowdfund } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale,
      investorContributionsUSDC: [{ signer: investor1, amount: 3n * ONE_USDC }],
    });

    await expectRevert(crowdfund.connect(investor2).claimTokens(), "No tokens claimable");
  });

  it("reverts on double token claim", async function () {
    const [investor1] = (await ethers.getSigners()).slice(1, 2);
    const totalEquityTokensForSale = ethers.parseUnits("1000", 18);
    const { crowdfund } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale,
      investorContributionsUSDC: [{ signer: investor1, amount: 3n * ONE_USDC }],
    });

    await crowdfund.connect(investor1).claimTokens();
    await expectRevert(crowdfund.connect(investor1).claimTokens(), "No tokens claimable");
  });

  it("distributes pro-rata tokens with leftover in contract", async function () {
    const totalEquityTokens = ethers.parseUnits("100", 18);
    const [investor1, investor2, investor3] = (await ethers.getSigners()).slice(1, 4);
    const { crowdfund, equityToken } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale: totalEquityTokens,
      investorContributionsUSDC: [
        { signer: investor1, amount: ONE_USDC },
        { signer: investor2, amount: ONE_USDC },
        { signer: investor3, amount: ONE_USDC },
      ],
    });

    const expectedEach = totalEquityTokens / 3n;
    const expectedTotalClaimed = expectedEach * 3n;
    const expectedLeftover = totalEquityTokens - expectedTotalClaimed;

    await crowdfund.connect(investor1).claimTokens();
    await crowdfund.connect(investor2).claimTokens();
    await crowdfund.connect(investor3).claimTokens();

    expect(await equityToken.balanceOf(investor1.address)).to.equal(expectedEach);
    expect(await equityToken.balanceOf(investor2.address)).to.equal(expectedEach);
    expect(await equityToken.balanceOf(investor3.address)).to.equal(expectedEach);
    expect(expectedEach + expectedEach + expectedEach).to.equal(expectedTotalClaimed);
    expect(await equityToken.balanceOf(crowdfund.target)).to.equal(expectedLeftover);
  });

  it("reverts when entitlement rounds down to zero", async function () {
    const [investor1, investor2] = (await ethers.getSigners()).slice(1, 3);
    const totalEquityTokensForSale = 1n;
    const { crowdfund } = await setupSuccessfulCampaignAndEquity({
      totalEquityTokensForSale,
      investorContributionsUSDC: [
        { signer: investor1, amount: ONE_USDC },
        { signer: investor2, amount: ONE_USDC },
      ],
    });

    await expectRevert(crowdfund.connect(investor1).claimTokens(), "No tokens claimable");
  });

  it("blocks reentrancy during refund via malicious token", async function () {
    const [admin, investor1] = await ethers.getSigners();
    const MockReentrantERC20 = await ethers.getContractFactory("MockReentrantERC20");
    const reentrantUsdc = await MockReentrantERC20.deploy("USD Coin", "USDC", 6);

    const now = await time.latest();
    const startTime = now - 10;
    const endTime = now + 1000;
    const targetAmount = 3n * ONE_USDC;
    const totalEquityTokens = ethers.parseUnits("1000", 18);

    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      reentrantUsdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokens,
      "PROP-1"
    );

    await reentrantUsdc.mint(investor1.address, 10n * ONE_USDC);
    await reentrantUsdc.connect(investor1).approve(crowdfund.target, ONE_USDC);
    await crowdfund.connect(investor1).invest(ONE_USDC);

    await time.increaseTo(endTime + 1);
    await crowdfund.finalizeCampaign();

    const data = crowdfund.interface.encodeFunctionData("invest", [ONE_USDC]);
    await reentrantUsdc.setReentrancy(true, crowdfund.target, crowdfund.target, data);

    await expectRevert(
      crowdfund.connect(investor1).claimRefund(),
      "ReentrancyGuardReentrantCall"
    );
  });

  it("blocks reentrancy during token claim via malicious token", async function () {
    const [admin, investor1] = await ethers.getSigners();
    const MockReentrantERC20 = await ethers.getContractFactory("MockReentrantERC20");
    const usdc = await MockReentrantERC20.deploy("USD Coin", "USDC", 6);
    const equity = await MockReentrantERC20.deploy("Equity Token", "EQT", 18);

    const now = await time.latest();
    const startTime = now - 10;
    const endTime = now + 1000;
    const targetAmount = 3n * ONE_USDC;
    const totalEquityTokens = ethers.parseUnits("1000", 18);

    const Crowdfund = await ethers.getContractFactory("PropertyCrowdfund");
    const crowdfund = await Crowdfund.deploy(
      admin.address,
      usdc.target,
      targetAmount,
      startTime,
      endTime,
      totalEquityTokens,
      "PROP-1"
    );

    await usdc.mint(investor1.address, 10n * ONE_USDC);
    await usdc.connect(investor1).approve(crowdfund.target, 3n * ONE_USDC);
    await crowdfund.connect(investor1).invest(3n * ONE_USDC);

    await crowdfund.finalizeCampaign();
    await equity.mint(crowdfund.target, totalEquityTokens);
    await crowdfund.connect(admin).setEquityToken(equity.target);

    const data = crowdfund.interface.encodeFunctionData("claimTokens");
    await equity.setReentrancy(true, crowdfund.target, crowdfund.target, data);

    await expectRevert(
      crowdfund.connect(investor1).claimTokens(),
      "ReentrancyGuardReentrantCall"
    );
  });
});
