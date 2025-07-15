const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env" });

async function main() {
  console.log("🚀 Starting LimitlessFlashBot deployment...");
  
  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Contract addresses for mainnet
  const ADDRESSES = {
    AAVE_POOL_ADDRESS_PROVIDER: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    UNISWAP_V2_ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    SUSHISWAP_ROUTER: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    UNISWAP_V3_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    PROFIT_WALLET: process.env.PROFIT_WALLET || "0xDe32ebF443f213E6b904461FfBE3e107b93CE3Bc"
  };

  console.log("Using profit wallet:", ADDRESSES.PROFIT_WALLET);

  // Deploy the contract
  const LimitlessFlashBot = await ethers.getContractFactory("LimitlessFlashBot");
  
  console.log("Deploying LimitlessFlashBot...");
  const flashBot = await LimitlessFlashBot.deploy(
    ADDRESSES.AAVE_POOL_ADDRESS_PROVIDER,
    ADDRESSES.PROFIT_WALLET,
    ADDRESSES.UNISWAP_V2_ROUTER,
    ADDRESSES.SUSHISWAP_ROUTER,
    ADDRESSES.UNISWAP_V3_ROUTER
  );

  await flashBot.deployed();

  console.log("✅ LimitlessFlashBot deployed to:", flashBot.address);
  console.log("📊 Transaction hash:", flashBot.deployTransaction.hash);
  console.log("⛽ Gas used:", flashBot.deployTransaction.gasLimit.toString());

  // Wait for a few confirmations
  console.log("⏳ Waiting for confirmations...");
  await flashBot.deployTransaction.wait(5);

  // Verify contract on Etherscan if API key is provided
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: flashBot.address,
        constructorArguments: [
          ADDRESSES.AAVE_POOL_ADDRESS_PROVIDER,
          ADDRESSES.PROFIT_WALLET,
          ADDRESSES.UNISWAP_V2_ROUTER,
          ADDRESSES.SUSHISWAP_ROUTER,
          ADDRESSES.UNISWAP_V3_ROUTER
        ],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  // Set up initial configuration
  console.log("⚙️ Setting up initial configuration...");
  
  // Add deployer as authorized executor
  const addExecutorTx = await flashBot.addAuthorizedExecutor(deployer.address);
  await addExecutorTx.wait();
  console.log("✅ Added deployer as authorized executor");

  // Add common mainnet tokens as supported assets
  const MAINNET_TOKENS = {
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDC: "0xA0b86a33E6441E6C5E6c7c8b0E0c4B5c5c5c5c5c",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
  };

  for (const [symbol, address] of Object.entries(MAINNET_TOKENS)) {
    try {
      const addAssetTx = await flashBot.addSupportedAsset(address);
      await addAssetTx.wait();
      console.log(`✅ Added ${symbol} as supported asset`);
    } catch (error) {
      console.log(`❌ Failed to add ${symbol}:`, error.message);
    }
  }

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    contractAddress: flashBot.address,
    deployerAddress: deployer.address,
    profitWallet: ADDRESSES.PROFIT_WALLET,
    transactionHash: flashBot.deployTransaction.hash,
    blockNumber: flashBot.deployTransaction.blockNumber,
    gasUsed: flashBot.deployTransaction.gasLimit.toString(),
    timestamp: new Date().toISOString(),
    addresses: ADDRESSES
  };

  // Write deployment info to file
  const fs = require("fs");
  const path = require("path");
  
  const deploymentDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentDir, `${hre.network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("📄 Deployment info saved to:", deploymentFile);

  console.log("🎉 Deployment completed successfully!");
  console.log("📋 Summary:");
  console.log("  Contract Address:", flashBot.address);
  console.log("  Profit Wallet:", ADDRESSES.PROFIT_WALLET);
  console.log("  Network:", hre.network.name);
  console.log("  Deployer:", deployer.address);
  
  return {
    contractAddress: flashBot.address,
    deploymentInfo
  };
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = main;

