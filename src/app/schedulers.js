function startSchedulers() {
  const serverModule = require('../../server');
  return serverModule.startSchedulers();
}

function stopSchedulers() {
  const serverModule = require('../../server');
  return serverModule.stopSchedulers();
}

module.exports = {
  startSchedulers,
  stopSchedulers
};
