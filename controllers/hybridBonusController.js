const axios = require("axios");
const dotenv = require("dotenv");

const User = require("../models/User");
const HybridPackage = require("../models/HybridPackage");
const Transaction = require("../models/Transaction");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const { makeCryptoTransaction: makeUSDTCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");

dotenv.config();

const CGT_HOMES_API_URL =
  process.env.CGT_HOMES_API_URL || "https://cgt-homes-be.onrender.com/api";

const USDT_USD = 10;
const RETOPUP_USD = 10;
const CGT_HOMES_USD = 10;
const INR_RATE = 90;
const MATURITY_DAYS = 100;
const MAX_WITHDRAWALS_PER_WINDOW = 5;
const WINDOW_HOURS = 48;

const daysSince = (d) =>
  Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

// Same person = same email OR same phone, even across different userIds.
// Cap hybrid-bonus withdrawals at 5 per rolling 48h to prevent mass-claim across sibling accounts.
const checkWithdrawalLimit = async (user) => {
  const orClauses = [];
  if (user.email) orClauses.push({ email: user.email });
  if (user.phone) orClauses.push({ phone: user.phone });

  let siblingUserIds = [user.userId];
  if (orClauses.length > 0) {
    const siblings = await User.find({ $or: orClauses }).select("userId");
    siblingUserIds = [...new Set([user.userId, ...siblings.map((s) => s.userId)])];
  }

  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const recentCount = await Transaction.countDocuments({
    userId: { $in: siblingUserIds },
    "metadata.withdrawalType": "HybridBonusRealWallet",
    status: "Completed",
    createdAt: { $gte: windowStart },
  });

  return { allowed: recentCount < MAX_WITHDRAWALS_PER_WINDOW, recentCount };
};

const withdrawHybridBonus = async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.connectedCGTHomesEmail) {
      return res.status(400).json({ success: false, message: "CGT Homes account not connected" });
    }

    if (!user.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return res.status(400).json({ success: false, message: "Valid wallet address required" });
    }

    const { allowed, recentCount } = await checkWithdrawalLimit(user);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        message: `Withdrawal limit reached: max ${MAX_WITHDRAWALS_PER_WINDOW} bonuses per ${WINDOW_HOURS}h across accounts sharing your email/phone. Try again later.`,
        recentCount,
      });
    }

    const pkg = await HybridPackage.findOne({ userId }).sort({ createdAt: 1 });
    if (!pkg) return res.status(404).json({ success: false, message: "Hybrid package not found" });

    if (pkg.bonusWithdrawn) {
      return res.status(400).json({ success: false, message: "Bonus already withdrawn" });
    }

    const days = daysSince(pkg.cycleStartedAt || pkg.createdAt);
    if (days < MATURITY_DAYS) {
      return res.status(400).json({
        success: false,
        message: `Package not mature. ${MATURITY_DAYS - days} day(s) remaining.`,
      });
    }

    const pkgRef = String(pkg._id);
    const inrAmount = CGT_HOMES_USD * INR_RATE;

    // 1. USDT payout FIRST — gate everything else on real-crypto success.
    //    If this fails, no DB mutations happen downstream.
    let usdtTxHash;
    try {
      usdtTxHash = await makeUSDTCryptoTransaction(USDT_USD, user.walletAddress);
    } catch (err) {
      await new Transaction({
        userId,
        walletName: "USDTBalance",
        transactionRemark: `Hybrid Bonus - USDT payout FAILED (${pkgRef})`,
        status: "Failed",
        toAddress: user.walletAddress,
        metadata: { packageId: pkgRef, withdrawalType: "HybridBonusRealWallet", error: err.message },
      }).save();
      return res.status(500).json({
        success: false,
        message: "USDT payout failed. Bonus withdrawal cancelled.",
        error: err.message,
      });
    }

    await new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: USDT_USD,
      transactionRemark: `Hybrid Bonus - Real Wallet (${pkgRef})`,
      status: "Completed",
      txHash: usdtTxHash,
      toAddress: user.walletAddress,
      metadata: { packageId: pkgRef, withdrawalType: "HybridBonusRealWallet" },
    }).save();

    // 2. Retopup credit (post-USDT; internal, reliable)
    await performWalletTransaction(
      userId,
      RETOPUP_USD,
      "retopupBalance",
      `Hybrid Bonus - Retopup (${pkgRef})`,
      "Completed",
      { metadata: { packageId: pkgRef, withdrawalType: "HybridBonusRetopup" } }
    );

    // 3. CGT Homes INR credit. USDT already sent — on failure we log for admin reconciliation, not rollback.
    let cgtHomesOk = false;
    let cgtHomesError = null;
    try {
      const resp = await axios.post(`${CGT_HOMES_API_URL}/wallet/add-balance`, {
        email: user.connectedCGTHomesEmail,
        amount: inrAmount,
        transactionRemark: `Hybrid Bonus from CryptoGT - ${userId}`,
        liveToken: CGT_HOMES_USD,
        status: "Success",
        source: "CryptoGT-HybridBonus",
      });
      cgtHomesOk = Boolean(resp.data?.success);
      if (!cgtHomesOk) cgtHomesError = resp.data?.message || "CGT Homes credit failed";
    } catch (err) {
      cgtHomesError = err.message;
    }

    await new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: `Hybrid Bonus - CGT Homes Transfer (${pkgRef})`,
      status: cgtHomesOk ? "Completed" : "Failed",
      metadata: {
        packageId: pkgRef,
        withdrawalType: "HybridBonusCGTHomes",
        cgtHomesInrAmount: inrAmount,
        destinationEmail: user.connectedCGTHomesEmail,
        error: cgtHomesError,
      },
    }).save();

    pkg.bonusWithdrawn = true;
    pkg.bonusGenerated = USDT_USD + RETOPUP_USD + CGT_HOMES_USD;
    if (pkg.status !== "Mature") pkg.status = "Mature";
    await pkg.save();

    return res.json({
      success: true,
      message: cgtHomesOk
        ? "Hybrid bonus withdrawn successfully"
        : "USDT + retopup done; CGT Homes credit failed and is flagged for reconciliation",
      data: {
        packageId: pkgRef,
        realWalletUSDT: USDT_USD,
        retopupUSD: RETOPUP_USD,
        cgtHomesINR: inrAmount,
        cgtHomesOk,
        cgtHomesError,
        txHash: usdtTxHash,
      },
    });
  } catch (error) {
    console.error("withdrawHybridBonus error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while withdrawing hybrid bonus",
      error: error.message,
    });
  }
};

// Free rejoin (pre-withdraw): user forfeits accrued $30 bonus to restart the cycle. No crypto moves.
// Paid rejoin (post-withdraw): fresh 10 USDT deposit (txnId from client-side MetaMask transfer) restarts cycle.
const rejoinHybrid = async (req, res) => {
  const userId = req.user.userId;
  const { txnId } = req.body || {};

  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const pkg = await HybridPackage.findOne({ userId }).sort({ createdAt: 1 });
    if (!pkg) return res.status(404).json({ success: false, message: "Hybrid package not found" });

    const days = daysSince(pkg.cycleStartedAt || pkg.createdAt);
    const paidMode = !!pkg.bonusWithdrawn;

    if (paidMode) {
      if (!txnId) {
        return res.status(400).json({
          success: false,
          message: "txnId required — please complete the 10 USDT transfer first",
        });
      }
    } else {
      if (days < MATURITY_DAYS) {
        return res.status(400).json({
          success: false,
          message: `Rejoin unlocks at day ${MATURITY_DAYS}. ${MATURITY_DAYS - days} day(s) remaining.`,
        });
      }
    }

    pkg.cycleStartedAt = new Date();
    pkg.bonusWithdrawn = false;
    pkg.bonusGenerated = 0;
    pkg.rejoinCount = (pkg.rejoinCount || 0) + 1;
    if (paidMode) pkg.txnId = txnId;
    await pkg.save();

    await new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: paidMode
        ? `Hybrid Rejoin (Paid, 10 USDT) - Package: ${pkg._id}`
        : `Hybrid Rejoin (Free, bonus forfeited) - Package: ${pkg._id}`,
      status: "Completed",
      txHash: paidMode ? txnId : undefined,
      metadata: {
        packageId: String(pkg._id),
        withdrawalType: paidMode ? "HybridRejoinPaid" : "HybridRejoinFree",
        rejoinCount: pkg.rejoinCount,
      },
    }).save();

    return res.json({
      success: true,
      message: paidMode ? "Rejoined successfully with 10 USDT deposit" : "Rejoined successfully",
      data: {
        packageId: String(pkg._id),
        cycleStartedAt: pkg.cycleStartedAt,
        rejoinCount: pkg.rejoinCount,
        mode: paidMode ? "paid" : "free",
      },
    });
  } catch (error) {
    console.error("rejoinHybrid error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while rejoining hybrid",
      error: error.message,
    });
  }
};

module.exports = { withdrawHybridBonus, rejoinHybrid };
