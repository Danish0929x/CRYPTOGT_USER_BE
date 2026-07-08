# Email & Password Authentication Setup Guide

## What Was Added

### 1. **Database Schema Changes**
- Updated User model with new fields:
  - `password` (String, nullable) - stores hashed password
  - `isEmailVerified` (Boolean) - tracks email verification status

### 2. **Migration**
- Created migration: `migrations/add_password_field.js`
- Run migration with: `node scripts/runMigration.js`

### 3. **New Authentication Endpoints**

#### Email/Password Login
```
POST /api/auth/login/email
Body: {
  "email": "user@example.com",
  "password": "userPassword123"
}
Response: {
  "success": true,
  "token": "jwt_token",
  "message": "Login Successful"
}
```

#### Set Initial Password (after account creation)
```
POST /api/set-password
Body: {
  "email": "user@example.com",
  "newPassword": "MyNewPassword123"
}
```

#### Change Password
```
POST /api/change-password
Body: {
  "email": "user@example.com",
  "oldPassword": "currentPassword123",
  "newPassword": "newPassword123"
}
```

### 4. **Utilities Created**

#### Password Utils (`utils/passwordUtils.js`)
- `hashPassword()` - bcrypt password hashing
- `comparePassword()` - verify passwords
- `generateRandomPassword()` - create 12-char passwords
- `validatePasswordStrength()` - enforce rules (8+ chars, uppercase, lowercase, numbers)

#### Email Service (`utils/emailService.js`)
- `sendTemporaryPasswordEmail()` - send initial password
- `sendPasswordChangedEmail()` - confirmation email
- `verifyEmailConnection()` - test email setup

### 5. **Scripts Created**

#### Migration Runner
```bash
node scripts/runMigration.js
```
Adds password fields to existing users.

#### Password Generator
```bash
node scripts/generateInitialPasswords.js
```
Generates temporary passwords for all users without passwords.
Exports CSV with credentials for email distribution.

---

## Setup Instructions

### Step 1: Configure Environment Variables

Add these to your `.env` file:

```env
# Email Configuration
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
FRONTEND_URL=https://your-frontend-domain.com
```

**For Gmail:**
1. Enable 2-Factor Authentication
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the generated 16-char password as `EMAIL_PASSWORD`

### Step 2: Run Migration

```bash
node scripts/runMigration.js
```

Output will show:
- How many users were updated
- Confirmation of password fields added

### Step 3: Generate Initial Passwords

```bash
node scripts/generateInitialPasswords.js
```

This will:
- Create temporary password for each user
- Generate CSV file with credentials
- Show file path for email distribution

### Step 4: Send Emails to Users

Use the CSV file from Step 3 to send emails with temporary passwords to users.
Users will need to change password on first login.

---

## Frontend Integration

### Login Page (Email/Password)

```javascript
import axios from 'axios';

const loginWithEmail = async (email, password) => {
  const response = await axios.post('/api/auth/login/email', {
    email,
    password
  });
  return response.data;
};

const setPassword = async (email, newPassword) => {
  const response = await axios.post('/api/set-password', {
    email,
    newPassword
  });
  return response.data;
};

const changePassword = async (email, oldPassword, newPassword) => {
  const response = await axios.post('/api/change-password', {
    email,
    oldPassword,
    newPassword
  });
  return response.data;
};
```

---

## Password Requirements

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- Optional: special characters recommended

---

## Next Steps

1. ✅ Add environment variables to `.env`
2. ✅ Run migration script
3. ✅ Test endpoints with Postman/Insomnia
4. ✅ Update frontend with email/password login form
5. ✅ Configure email service
6. ✅ Run password generation script
7. ✅ Send initial passwords to users

---

## Troubleshooting

**Email not sending:**
- Verify EMAIL_USER and EMAIL_PASSWORD are correct
- Run `verifyEmailConnection()` in email service
- Check Gmail App Passwords configuration

**Migration fails:**
- Ensure MongoDB is running
- Check MONGODB_URI in .env
- Verify User model is properly imported

**Duplicate user issues:**
- Email field should be unique (add to schema if needed)
- Consider adding sparse index for email field

