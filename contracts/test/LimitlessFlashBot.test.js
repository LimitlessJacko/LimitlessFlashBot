const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("LimitlessFlashBot", function () {
  // Contract addresses for mainnet fork
  const ADDRESSES = {
    AAVE_POOL_ADDRESS_PROVIDER: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    AAVE_POOL: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    UNISWAP_V2_ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    SUSHISWAP_ROUTER: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    UNISWAP_V3_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDC: "0xA0b86a33E6441E6C5E6c7c8b0E0c4B5c5c5c5c5c",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
  };

  async function deployFlashBotFixture() {
    const [owner, profitWallet, executor, user] = await ethers.getSigners();

    // Deploy the contract
    const LimitlessFlashBot = await ethers.getContractFactory("LimitlessFlashBot");
    const flashBot = await LimitlessFlashBot.deploy(
      ADDRESSES.AAVE_POOL_ADDRESS_PROVIDER,
      profitWallet.address,
      ADDRESSES.UNISWAP_V2_ROUTER,
      ADDRESSES.SUSHISWAP_ROUTER,
      ADDRESSES.UNISWAP_V3_ROUTER
    );

    // Get token contracts
    const weth = await ethers.getContractAt("IERC20", ADDRESSES.WETH);
    const dai = await ethers.getContractAt("IERC20", ADDRESSES.DAI);
    const usdc = await ethers.getContractAt("IERC20", ADDRESSES.USDC);

    // Add executor
    await flashBot.addAuthorizedExecutor(executor.address);

    return {
      flashBot,
      owner,
      profitWallet,
      executor,
      user,
      weth,
      dai,
      usdc
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { flashBot, profitWallet } = await loadFixture(deployFlashBotFixture);

      expect(await flashBot.profitWallet()).to.equal(profitWallet.address);
      expect(await flashBot.mevProtectionEnabled()).to.be.true;
      expect(await flashBot.maxGasPrice()).to.equal(ethers.utils.parseUnits("100", "gwei"));
    });

    it("Should set owner correctly", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);
      expect(await flashBot.owner()).to.equal(owner.address);
    });

    it("Should initialize with supported assets", async function () {
      const { flashBot } = await loadFixture(deployFlashBotFixture);
      
      // Note: The contract has placeholder addresses, in real deployment these would be actual token addresses
      // This test would need to be updated with actual supported assets
      expect(await flashBot.supportedAssets(ADDRESSES.WETH)).to.be.false; // Will be false until properly configured
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to add authorized executor", async function () {
      const { flashBot, owner, user } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).addAuthorizedExecutor(user.address);
      expect(await flashBot.authorizedExecutors(user.address)).to.be.true;
    });

    it("Should allow owner to remove authorized executor", async function () {
      const { flashBot, owner, executor } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).removeAuthorizedExecutor(executor.address);
      expect(await flashBot.authorizedExecutors(executor.address)).to.be.false;
    });

    it("Should not allow non-owner to add executor", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      await expect(
        flashBot.connect(user).addAuthorizedExecutor(user.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Asset Management", function () {
    it("Should allow owner to add supported asset", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).addSupportedAsset(ADDRESSES.WETH);
      expect(await flashBot.supportedAssets(ADDRESSES.WETH)).to.be.true;
    });

    it("Should allow owner to remove supported asset", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).addSupportedAsset(ADDRESSES.WETH);
      await flashBot.connect(owner).removeSupportedAsset(ADDRESSES.WETH);
      expect(await flashBot.supportedAssets(ADDRESSES.WETH)).to.be.false;
    });

    it("Should not allow non-owner to manage assets", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      await expect(
        flashBot.connect(user).addSupportedAsset(ADDRESSES.WETH)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("MEV Protection", function () {
    it("Should allow owner to toggle MEV protection", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).setMEVProtection(false);
      expect(await flashBot.mevProtectionEnabled()).to.be.false;

      await flashBot.connect(owner).setMEVProtection(true);
      expect(await flashBot.mevProtectionEnabled()).to.be.true;
    });

    it("Should allow owner to set max gas price", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      const newMaxGasPrice = ethers.utils.parseUnits("200", "gwei");
      await flashBot.connect(owner).setMaxGasPrice(newMaxGasPrice);
      expect(await flashBot.maxGasPrice()).to.equal(newMaxGasPrice);
    });

    it("Should emit MEVProtectionEnabled event", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await expect(flashBot.connect(owner).setMEVProtection(false))
        .to.emit(flashBot, "MEVProtectionEnabled")
        .withArgs(false);
    });
  });

  describe("Circuit Breaker", function () {
    it("Should allow owner to set max daily loss", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      const newMaxDailyLoss = ethers.utils.parseEther("2");
      await flashBot.connect(owner).setMaxDailyLoss(newMaxDailyLoss);
      expect(await flashBot.maxDailyLoss()).to.equal(newMaxDailyLoss);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to pause contract", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).pause();
      expect(await flashBot.paused()).to.be.true;
    });

    it("Should allow owner to unpause contract", async function () {
      const { flashBot, owner } = await loadFixture(deployFlashBotFixture);

      await flashBot.connect(owner).pause();
      await flashBot.connect(owner).unpause();
      expect(await flashBot.paused()).to.be.false;
    });

    it("Should not allow non-owner to pause", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      await expect(
        flashBot.connect(user).pause()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Flash Loan Execution", function () {
    it("Should reject execution from unauthorized user", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      const amount = ethers.utils.parseEther("1");
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address[]", "address[]", "address", "address", "uint256"],
        [
          [ADDRESSES.WETH, ADDRESSES.DAI],
          [ADDRESSES.DAI, ADDRESSES.WETH],
          ADDRESSES.UNISWAP_V2_ROUTER,
          ADDRESSES.SUSHISWAP_ROUTER,
          0
        ]
      );

      await expect(
        flashBot.connect(user).executeArbitrage(ADDRESSES.WETH, amount, params)
      ).to.be.revertedWith("Unauthorized executor");
    });

    it("Should reject execution for unsupported asset", async function () {
      const { flashBot, executor } = await loadFixture(deployFlashBotFixture);

      const amount = ethers.utils.parseEther("1");
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address[]", "address[]", "address", "address", "uint256"],
        [
          [ADDRESSES.WETH, ADDRESSES.DAI],
          [ADDRESSES.DAI, ADDRESSES.WETH],
          ADDRESSES.UNISWAP_V2_ROUTER,
          ADDRESSES.SUSHISWAP_ROUTER,
          0
        ]
      );

      await expect(
        flashBot.connect(executor).executeArbitrage(ADDRESSES.WETH, amount, params)
      ).to.be.revertedWith("Asset not supported");
    });

    it("Should reject zero amount", async function () {
      const { flashBot, executor, owner } = await loadFixture(deployFlashBotFixture);

      // Add WETH as supported asset
      await flashBot.connect(owner).addSupportedAsset(ADDRESSES.WETH);

      const params = ethers.utils.defaultAbiCoder.encode(
        ["address[]", "address[]", "address", "address", "uint256"],
        [
          [ADDRESSES.WETH, ADDRESSES.DAI],
          [ADDRESSES.DAI, ADDRESSES.WETH],
          ADDRESSES.UNISWAP_V2_ROUTER,
          ADDRESSES.SUSHISWAP_ROUTER,
          0
        ]
      );

      await expect(
        flashBot.connect(executor).executeArbitrage(ADDRESSES.WETH, 0, params)
      ).to.be.revertedWith("Invalid amount");
    });
  });

  describe("Liquidity Checks", function () {
    it("Should get available liquidity", async function () {
      const { flashBot } = await loadFixture(deployFlashBotFixture);

      const liquidity = await flashBot.getAvailableLiquidity(ADDRESSES.WETH);
      expect(liquidity).to.be.gt(0);
    });
  });

  describe("Receive and Fallback", function () {
    it("Should receive ETH", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      const amount = ethers.utils.parseEther("1");
      await expect(
        user.sendTransaction({
          to: flashBot.address,
          value: amount
        })
      ).to.not.be.reverted;

      expect(await ethers.provider.getBalance(flashBot.address)).to.equal(amount);
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should allow owner to emergency withdraw ETH", async function () {
      const { flashBot, owner, user } = await loadFixture(deployFlashBotFixture);

      // Send ETH to contract
      const amount = ethers.utils.parseEther("1");
      await user.sendTransaction({
        to: flashBot.address,
        value: amount
      });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      
      const tx = await flashBot.connect(owner).emergencyWithdrawETH();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      
      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore.add(amount).sub(gasUsed));
      expect(await ethers.provider.getBalance(flashBot.address)).to.equal(0);
    });

    it("Should not allow non-owner to emergency withdraw", async function () {
      const { flashBot, user } = await loadFixture(deployFlashBotFixture);

      await expect(
        flashBot.connect(user).emergencyWithdrawETH()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});

