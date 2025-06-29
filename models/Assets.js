const mongoose = require("mongoose");

const assetsSchema = new mongoose.Schema({
  liveRate:{
    type: Number, 
    default: 0  
  },
  announcement: {
    type: String,
    default: "",
  },
  popUpImage: {
    type: String,  
    default: "",   
  },
});

const Assets = mongoose.model("Assets", assetsSchema);

module.exports = Assets;