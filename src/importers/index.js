const { parseInterCSV } = require("./inter");

function parseCsvByCardName(cardName, buffer) {
  const name = (cardName || "").toLowerCase();
  if (name.includes("inter")) return parseInterCSV(buffer);
  return parseInterCSV(buffer);
}

module.exports = { parseCsvByCardName };
