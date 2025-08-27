// utils/cryptoService.js
require("dotenv").config();
const ethers = require("ethers");
const { Wallet, JsonRpcProvider } = require("ethers");


// --- Setup provider & wallet (ethers v6) ---
const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
const wallet = Wallet.fromPhrase(process.env.MNEMONIC).connect(provider);
// console.log("Address:", wallet.address);
// console.log("Private Key:", wallet.privateKey);

// Minimal ERC-20 ABI for `transfer()`
const USDT_ABI = [
  "function transfer(address to, uint256 value) external returns (bool)"
];

/**
 * Sends USDT (BEP-20) from your configured wallet to `recipientAddress`.
 * @param {number|string} amountUSDT       e.g. "12.5"
 * @param {string}        recipientAddress BSC address
 * @returns {Promise<string>}              The tx hash
 */
async function makeCryptoTransaction(amountUSDT, recipientAddress) {
  try {
    // parse to 18 decimals (top‐level parseUnits in v6)
    const value = ethers.parseUnits(amountUSDT.toString(), 18);

    // connect to your USDT contract
    const contract = new ethers.Contract(
      process.env.USDT_CONTRACT_ADDRESS,
      USDT_ABI,
      wallet
    );

    // send the transfer
    const tx = await contract.transfer(recipientAddress, value);
    console.log(`→ Submitted tx ${tx.hash}, waiting for 1 confirmation…`);

    const receipt = await tx.wait(1);
    console.log(`↳ Confirmed in block ${receipt.blockNumber}`);
    return tx.hash;
  } catch (err) {
    console.error(
      `‼ makeCryptoTransaction error sending ${amountUSDT} USDT to ${recipientAddress}:`,
      err
    );
    throw err;
  }
}

module.exports = { makeCryptoTransaction };
