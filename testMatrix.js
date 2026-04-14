const mongoose = require("mongoose");
require("dotenv").config();
const User = require("./models/User");
const HybridPackage = require("./models/HybridPackage");
const MatrixPackage = require("./models/MatrixPackage");

// Use a separate test database
const TEST_DB_URI = process.env.MONGO_URI.replace(
  /\/([^/?]+)(\?|$)/,
  "/CryptographyTest$2"
);

const connectDB = async () => {
  await mongoose.connect(TEST_DB_URI);
  console.log("Connected to TEST database:", mongoose.connection.name);
};

const cleanup = async () => {
  await User.deleteMany({});
  await HybridPackage.deleteMany({});
  await MatrixPackage.deleteMany({});
  console.log("Cleaned up test data\n");
};

// Helper: create a user
const createUser = async (userId, name, parentId) => {
  const user = new User({
    userId,
    name,
    parentId,
    walletAddress: `0xTEST_${userId}`,
    rewardStatus: "User",
  });
  await user.save();
  console.log(`  Created user: ${name} (${userId}) -> parent: ${parentId}`);
  return user;
};

// Helper: join hybrid (calls the controller logic directly)
const joinHybrid = async (userId) => {
  const { createHybridPackage } = require("./controllers/packageController");

  const req = { user: { userId }, body: { txnId: `txn_${userId}` } };
  let result = null;

  const res = {
    status: (code) => ({
      json: (data) => {
        result = { code, ...data };
      },
    }),
  };

  await createHybridPackage(req, res);
  return result;
};

// Helper: print tree state
const printState = async (label) => {
  console.log(`\n--- ${label} ---`);

  const hybridPkgs = await HybridPackage.find().sort({ position: 1 }).lean();
  console.log(`  Hybrid packages (${hybridPkgs.length}):`);
  hybridPkgs.forEach((p) => {
    console.log(
      `    pos:${p.position} user:${p.userId} matrixL:${p.matrixLeft || "-"} matrixR:${p.matrixRight || "-"}`
    );
  });

  const matrixPkgs = await MatrixPackage.find().sort({ hm: 1, part: 1, position: 1 }).lean();
  if (matrixPkgs.length > 0) {
    console.log(`  Matrix packages (${matrixPkgs.length}):`);
    matrixPkgs.forEach((p) => {
      console.log(
        `    HM${p.hm}-P${p.part} pos:${p.position} user:${p.userId} children:${p.children.length} status:${p.status}`
      );
    });
  } else {
    console.log("  Matrix packages: none");
  }
};

// ═══════════════════════════════════════
// TEST SCENARIO
// ═══════════════════════════════════════
// A is the root sponsor
// A has directs: B, C, D
// B joins hybrid -> A gets matrixLeft = B
// C joins hybrid -> A gets matrixRight = C -> A enters matrix with B & C
// D joins hybrid -> stays in hybrid only (A's matrix slots full)
// B gets directs: E, F
// E joins -> B gets matrixLeft = E
// F joins -> B gets matrixRight = F -> B enters matrix under A

const main = async () => {
  await connectDB();
  await cleanup();

  console.log("=== STEP 1: Create Users ===");
  const root = await createUser("ROOT", "Root", "SYSTEM");
  await createUser("A", "Alice", "ROOT");
  await createUser("B", "Bob", "A");
  await createUser("C", "Charlie", "A");
  await createUser("D", "Dave", "A");
  await createUser("E", "Eve", "B");
  await createUser("F", "Frank", "B");

  // ROOT needs hybrid first so A can join
  console.log("\n=== STEP 2: ROOT joins hybrid ===");
  let r = await joinHybrid("ROOT");
  console.log(`  Result: ${r.code} - ${r.message}`);

  console.log("\n=== STEP 3: A joins hybrid ===");
  r = await joinHybrid("A");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After A joins");

  console.log("\n=== STEP 4: B joins hybrid (A's 1st direct) ===");
  r = await joinHybrid("B");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After B joins");

  console.log("\n=== STEP 5: C joins hybrid (A's 2nd direct -> A enters matrix!) ===");
  r = await joinHybrid("C");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After C joins - A should be in matrix with B & C");

  console.log("\n=== STEP 6: D joins hybrid (A's 3rd direct -> no matrix entry) ===");
  r = await joinHybrid("D");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After D joins - D should NOT be in matrix");

  console.log("\n=== STEP 7: E joins hybrid (B's 1st direct) ===");
  r = await joinHybrid("E");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After E joins");

  console.log("\n=== STEP 8: F joins hybrid (B's 2nd direct -> B enters matrix!) ===");
  r = await joinHybrid("F");
  console.log(`  Result: ${r.code} - ${r.message}`);
  await printState("After F joins - B should be in matrix with E & F");

  console.log("\n=== TEST COMPLETE ===");
  await mongoose.connection.close();
};

main().catch(async (err) => {
  console.error("Test failed:", err);
  await mongoose.connection.close();
  process.exit(1);
});
