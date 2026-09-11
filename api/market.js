import { buildSnapshot } from '../scripts/update-market-data.js';
import { createLiveMarket, createMarketHandler } from '../scripts/live-market.js';

export default createMarketHandler(createLiveMarket({ build: buildSnapshot }));
