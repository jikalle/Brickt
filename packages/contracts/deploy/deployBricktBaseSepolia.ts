import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const parseDecimals = (): number => {
  const raw = (process.env.BRICKT_TOKEN_DECIMALS || "18").trim();
  const decimals = Number(raw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Invalid BRICKT_TOKEN_DECIMALS: ${raw}`);
  }
  return decimals;
};

const parseTokenUnits = (value: string | undefined, decimals: number, fallback: string): bigint => {
  const normalized = (value || fallback).trim();
  return ethers.parseUnits(normalized, decimals);
};

async function main() {
  console.log("Deploying BricktToken to Base Sepolia...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  const tokenName = (process.env.BRICKT_TOKEN_NAME || "Brickt Token").trim();
  const tokenSymbol = (process.env.BRICKT_TOKEN_SYMBOL || "BRICKT").trim();
  const decimals = parseDecimals();
  const initialSupply = parseTokenUnits(process.env.BRICKT_TOKEN_INITIAL_SUPPLY, decimals, "1000000");
  const cap = parseTokenUnits(process.env.BRICKT_TOKEN_CAP, decimals, "100000000");
  const owner = (process.env.BRICKT_TOKEN_OWNER || deployer.address).trim();

  if (initialSupply > cap) {
    throw new Error("Initial supply cannot exceed cap");
  }

  const BricktToken = await ethers.getContractFactory("BricktToken");
  const token = await BricktToken.deploy(tokenName, tokenSymbol, decimals, initialSupply, cap, owner);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const deploymentTx = token.deploymentTransaction()?.hash;
  const deploymentBlock = await ethers.provider.getBlockNumber();

  const deploymentInfo = {
    tokenName,
    tokenSymbol,
    decimals,
    initialSupply: initialSupply.toString(),
    cap: cap.toString(),
    owner,
    tokenAddress,
    deploymentTx,
    deploymentBlock,
    deployedAt: new Date().toISOString(),
  };

  console.log("\n" + "=".repeat(50));
  console.log("BricktToken deployed successfully");
  console.log("=".repeat(50));
  console.log(JSON.stringify(deploymentInfo, null, 2));
  console.log("=".repeat(50));

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const outputFile = path.join(deploymentsDir, "platform-token-addresses.json");
  let current = {} as Record<string, unknown>;
  if (fs.existsSync(outputFile)) {
    current = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  }

  current["base-sepolia"] = deploymentInfo;
  fs.writeFileSync(outputFile, JSON.stringify(current, null, 2));

  console.log(`Saved deployment info to ${outputFile}`);
  console.log("\nNext steps:");
  console.log(`1. Verify token on BaseScan`);
  console.log(
    `   npx hardhat verify --network base-sepolia ${tokenAddress} "${tokenName}" "${tokenSymbol}" ${decimals} ${initialSupply.toString()} ${cap.toString()} ${owner}`
  );
  console.log(`2. Add VITE_BASE_SEPOLIA_PLATFORM_TOKEN_ADDRESS=${tokenAddress} to frontend env`);
  console.log(`3. Create BRICKT/USDC liquidity before exposing BRICKT invest flow`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
