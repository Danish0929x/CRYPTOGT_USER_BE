const Assets = require('../models/Assets');

/**
 * Fetches the current live rate from database
 * @returns {Promise<Number>} Current live rate (returns 0 if no rate is set)
 */
const getLiveRate = async () => {
  try {
    const asset = await Assets.findOne({}).select('liveRate').lean();
    return asset?.liveRate || 0;
  } catch (error) {
    console.error('[liveRateUtils] Error fetching live rate:', error);
    return 0; // Return default value on error
  }
};

module.exports = getLiveRate;