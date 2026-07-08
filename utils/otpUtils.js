function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

function generateOTPWithExpiry() {
  const otp = generateOTP(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  return {
    otp,
    expiresAt,
    isExpired: () => new Date() > expiresAt
  };
}

function validateOTP(providedOTP, storedOTP, expiresAt) {
  if (!storedOTP || !expiresAt) {
    return { isValid: false, message: "OTP not found" };
  }

  if (new Date() > new Date(expiresAt)) {
    return { isValid: false, message: "OTP has expired" };
  }

  if (providedOTP !== storedOTP) {
    return { isValid: false, message: "Invalid OTP" };
  }

  return { isValid: true, message: "OTP verified successfully" };
}

module.exports = {
  generateOTP,
  generateOTPWithExpiry,
  validateOTP
};
