require('dotenv').config();
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { hashPassword, generateRandomPassword } = require('../utils/passwordUtils');

// ---- Config ----
const MAX_EMAILS_PER_RUN = Number(process.env.BULK_MAX_PER_RUN || 190); // stay under Mailjet daily cap
const DELAY_MS = Number(process.env.BULK_DELAY_MS || 400); // pause between sends
const FROM = process.env.MAILJET_FROM;

// Files persist across runs so we can resume and never lose plaintext passwords.
const PROGRESS_PATH = path.join(__dirname, 'bulk_progress.json'); // emails already emailed
const CSV_PATH = path.join(__dirname, 'bulk_passwords.csv'); // audit log (append-only)

// Mailjet SMTP relay via nodemailer
const transporter = nodemailer.createTransport({
  host: 'in-v3.mailjet.com',
  port: 587,
  auth: {
    user: process.env.MAILJET_API_KEY,
    pass: process.env.MAILJET_SECRET_KEY
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadProgress() {
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveProgress(doneSet) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify([...doneSet], null, 2));
}

function appendCsvRow(row) {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, 'Email,User IDs,ID Count,Password,Status,Sent At\n');
  }
  fs.appendFileSync(
    CSV_PATH,
    `"${row.email}","${row.userIds}",${row.idCount},"${row.password}","${row.status}",${row.at}\n`
  );
}

function buildEmailHtml(userIds, password) {
  const multiple = userIds.length > 1;
  const idListHtml = userIds.map((id) => `<li style="font-weight:bold;">${id}</li>`).join('');
  return `
    <h2>Welcome to CryptoGT!</h2>
    <p>${
      multiple
        ? 'This email is linked to the following CryptoGT accounts:'
        : 'Here are the login credentials for your CryptoGT account:'
    }</p>
    <ul>${idListHtml}</ul>
    <p><strong>Password:</strong> <code>${password}</code></p>
    ${multiple ? `<p>The same password works for all ${userIds.length} User IDs listed above.</p>` : ''}
    <p style="color:red;"><strong>Important:</strong> Please change this password immediately after your first login.</p>
    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login">Login to your account</a></p>
    <hr>
    <p>If you did not expect this email, please contact support.</p>
  `;
}

function isRateLimit(err) {
  const m = (err && err.message ? err.message : '').toLowerCase();
  return m.includes('rate') || m.includes('limit') || m.includes('quota') || m.includes('too many');
}

async function sendBulkPasswords() {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not defined in .env');
    if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
      throw new Error('MAILJET_API_KEY / MAILJET_SECRET_KEY are not set in .env');
    }
    if (!FROM || FROM.includes('PASTE')) throw new Error('MAILJET_FROM is not set in .env');

    console.log('========================================');
    console.log(' CryptoGT - Bulk Password Sender (Mailjet)');
    console.log('========================================\n');

    console.log('→ Verifying Mailjet SMTP credentials...');
    await transporter.verify();
    console.log('✓ Mailjet SMTP ready\n');

    console.log('→ Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    // STEP 1: all NON-blocked users that have an email
    console.log('→ Step 1: Finding non-blocked users with an email...');
    const users = await User.find({
      email: { $ne: null, $exists: true },
      blockStatus: { $ne: true }
    });
    console.log(`✓ Found ${users.length} account(s)\n`);

    // STEP 2: group user IDs by email
    console.log('→ Step 2: Grouping by email...');
    const groups = new Map(); // normalizedEmail -> { email, userIds: [] }
    for (const u of users) {
      if (!u.email) continue;
      const key = u.email.toLowerCase().trim();
      if (!groups.has(key)) groups.set(key, { email: u.email, userIds: [] });
      groups.get(key).userIds.push(u.userId);
    }

    // Skip emails already sent in a previous run (resume support)
    const done = loadProgress();
    const pending = [...groups.entries()].filter(([key]) => !done.has(key));
    console.log(
      `✓ ${groups.size} unique email(s); ${done.size} already done; ${pending.length} pending\n`
    );

    // STEP 3: send FIRST, then set password only on success
    console.log(`→ Step 3: Sending (max ${MAX_EMAILS_PER_RUN} this run)...\n`);
    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const [key, { email, userIds }] of pending) {
      if (processed >= MAX_EMAILS_PER_RUN) {
        console.log(`\n⏸  Reached per-run cap (${MAX_EMAILS_PER_RUN}). Re-run to continue.`);
        break;
      }
      processed++;
      const prefix = `[${processed}/${Math.min(pending.length, MAX_EMAILS_PER_RUN)}]`;

      const plainPassword = generateRandomPassword();

      // 1) Send email FIRST — do not touch the DB until this succeeds
      try {
        await transporter.sendMail({
          from: FROM,
          to: email,
          subject: 'Your CryptoGT Account - New Password',
          html: buildEmailHtml(userIds, plainPassword)
        });
      } catch (mailErr) {
        failed++;
        appendCsvRow({
          email,
          userIds: userIds.join(' | '),
          idCount: userIds.length,
          password: plainPassword,
          status: `SEND_FAILED (no password change): ${mailErr.message}`,
          at: new Date().toISOString()
        });
        console.error(`${prefix} ✗ ${email} — send failed, password NOT changed: ${mailErr.message}`);
        if (isRateLimit(mailErr)) {
          console.log('\n⏸  Mailjet limit hit. Stopping cleanly — re-run later to resume.');
          break;
        }
        await sleep(DELAY_MS);
        continue;
      }

      // 2) Email delivered → now set the same password on all IDs for this email
      const hashed = await hashPassword(plainPassword);
      const upd = await User.updateMany(
        { email: { $in: [email, key] } },
        { $set: { password: hashed, isEmailVerified: false } }
      );

      sent++;
      done.add(key);
      saveProgress(done);
      appendCsvRow({
        email,
        userIds: userIds.join(' | '),
        idCount: userIds.length,
        password: plainPassword,
        status: 'SENT',
        at: new Date().toISOString()
      });
      console.log(
        `${prefix} ✓ ${email} — ${userIds.length} ID(s): ${userIds.join(', ')} (pw updated: ${upd.modifiedCount})`
      );

      await sleep(DELAY_MS);
    }

    const remaining = pending.length - sent - failed;
    console.log('\n========================================');
    console.log(` Sent: ${sent} | Failed: ${failed} | Still pending: ${Math.max(remaining, 0)}`);
    console.log(` Progress file: ${PROGRESS_PATH}`);
    console.log(` Audit CSV:     ${CSV_PATH}  (contains plaintext — keep secure)`);
    if (remaining > 0) console.log(' Re-run the script to continue where it left off.');
    console.log('========================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
}

sendBulkPasswords();
