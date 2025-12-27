"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrice = getPrice;
const blockchain_1 = require("./blockchain");
async function getPrice(tokenAddress) {
    const price = await blockchain_1.contract.getTokenPrice(tokenAddress);
    return price;
}
//# sourceMappingURL=utils.js.map