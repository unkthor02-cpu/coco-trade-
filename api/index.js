const appHandler = require('../server.js');

module.exports = (req, res) => {
  return appHandler(req, res);
};
