// Nickland Edusoft Cloud — per-school API key helpers
const crypto = require('crypto');

function genKey() { return 'sk_' + crypto.randomBytes(24).toString('base64url'); }
function hashKey(k) { return crypto.createHash('sha256').update(String(k)).digest('hex'); }

module.exports = { genKey, hashKey };
