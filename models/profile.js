const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  withdrawAddress: {
    type: String,
     default: ""
  },
  phone: {
    type: String,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("Profile", profileSchema);