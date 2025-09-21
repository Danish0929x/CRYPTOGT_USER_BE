require("dotenv").config();
const ethers = require("ethers");
const { Wallet, JsonRpcProvider } = require("ethers");

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
const wallet = Wallet.fromPhrase(process.env.MNEMONIC).connect(provider);

const CUSTOM_TOKEN_ABI = [
  "function transfer(address to, uint256 value) external returns (bool)",
  "function decimals() external pure returns (uint256)",
  "function balanceOf(address user) external view returns (uint256)",
  "function name() external pure returns (string)",
  "function symbol() external pure returns (string)"
];

const CUSTOM_TOKEN_ADDRESS = "0xd9a3e6cF126b3C14F4C713ea9C13a7f5aae87dDE";

async function makeCryptoTransaction(amountTokens, recipientAddress) {
  try {
    const contract = new ethers.Contract(
      CUSTOM_TOKEN_ADDRESS,
      CUSTOM_TOKEN_ABI,
      wallet
    );

    const decimals = await contract.decimals();
    const value = ethers.parseUnits(amountTokens.toString(), decimals);
    const balance = await contract.balanceOf(wallet.address);
    
    if (balance < value) {
      throw new Error(`Insufficient balance. Required: ${amountTokens}, Available: ${ethers.formatUnits(balance, decimals)}`);
    }

    const tx = await contract.transfer(recipientAddress, value);
    const receipt = await tx.wait(1);
    return tx.hash;
  } catch (err) {
    throw err;
  }
}

async function getTokenInfo() {
  try {
    const contract = new ethers.Contract(
      CUSTOM_TOKEN_ADDRESS,
      CUSTOM_TOKEN_ABI,
      wallet
    );

    const [name, symbol, decimals, balance] = await Promise.all([
      contract.name(),
      contract.symbol(), 
      contract.decimals(),
      contract.balanceOf(wallet.address)
    ]);

    return {
      name,
      symbol,
      decimals: decimals.toString(),
      walletBalance: ethers.formatUnits(balance, decimals),
      contractAddress: CUSTOM_TOKEN_ADDRESS
    };
  } catch (err) {
    throw err;
  }
}

module.exports = { 
  makeCryptoTransaction,
  getTokenInfo 
};