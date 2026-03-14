const appConfig = require('../app.config.js');

module.exports = typeof appConfig === 'function'
    ? appConfig({ config: {} })
    : appConfig;
