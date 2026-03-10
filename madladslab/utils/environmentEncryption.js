const crypto = require('crypto');

module.exports = {
  encryptEnvVar: (envVar) => {
    const key = crypto.randomBytes(32);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(envVar);
    encrypted += cipher.final('hex');
    return { key: key.toString('hex'), encrypted: encrypted }; 
  },
  decryptEnvVar: (encrypted, key) => {
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
};