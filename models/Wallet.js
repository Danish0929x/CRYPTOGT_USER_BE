const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  USDTBalance: {
    type: Number,
    required: true,
    default: 0,
  },
  autopoolBalance: {
    type: Number,
    default: 0,
  },
  utilityBalance: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

// Round to 5 decimals before saving
walletSchema.pre('save', function (next) {
  const round = (num) => {
    if (typeof num === 'number') {
      return Number(num.toFixed(5));
    }
    return num;
  };

  this.USDTBalance = round(this.USDTBalance);
  this.autopoolBalance = round(this.autopoolBalance);
  this.utilityBalance = round(this.utilityBalance);

  next();
});

module.exports = mongoose.model('Wallet', walletSchema);
