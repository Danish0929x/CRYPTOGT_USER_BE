const axios = require("axios");
require("dotenv").config();

const TWO_FACTOR_API_KEY = process.env.TWO_FACTOR_API_KEY;
const BASE_URL = "https://2factor.in/API/V1";

/**
 * Send OTP to phone number via 2Factor.in
 * @param {string} phone - Phone number (e.g., 91XXXXXXXXXX)
 * @returns {string} sessionId - Session ID for verification
 */
const sendOTP = async (phone) => {
  const response = await axios.get(
    `${BASE_URL}/${TWO_FACTOR_API_KEY}/SMS/${phone}/AUTOGEN`
  );

  if (response.data.Status === "Success") {
    return response.data.Details; // session_id
  }

  throw new Error(response.data.Details || "Failed to send OTP");
};

/**
 * Verify OTP via 2Factor.in
 * @param {string} sessionId - Session ID from sendOTP
 * @param {string} otp - OTP entered by user
 * @returns {boolean} - True if OTP is valid
 */
const verifyOTP = async (sessionId, otp) => {
  const response = await axios.get(
    `${BASE_URL}/${TWO_FACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`
  );

  return response.data.Status === "Success";
};

module.exports = { sendOTP, verifyOTP };
