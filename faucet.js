import { ethers } from "ethers";
import { CdpClient } from "@coinbase/cdp-sdk";
import "dotenv/config";

const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
  walletSecret: process.env.CDP_WALLET_SECRET,
});

async function requestFaucet() {
  try {
    const address = ethers.getAddress(
      "0x5e7C5322CFC43e01dC29Cd53A77569719e4beff8"
    );
    console.log("Checksummed address:", address);

    const response = await cdp.evm.requestFaucet({
      address,
      network: "base-sepolia",
      token: "eth",
    });

    console.log("Faucet success! Tx hash:", response.transactionHash);
  } catch (error) {
    console.error("Faucet failed:", error);
  }
}

requestFaucet();