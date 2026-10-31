'use strict';

const { createRequestHandler } = require('../server');

const handler = createRequestHandler();

module.exports = (req, res) => {
  return handler(req, res);
};

