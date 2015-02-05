/*
 * Bedrock Identity Module Configuration.
 *
 * Copyright (c) 2012-2015 Digital Bazaar, Inc. All rights reserved.
 */
var config = require('bedrock').config;
var path = require('path');

config.identity = {};
// base path for identity IDs (appended to config.server.baseUri)
config.identity.basePath = '/i';
config.identity.defaults = {
  identity: {}
};
config.identity.identities = [];
config.identity.keys = [];

// mail config
config.mail.events.push({
  type: 'bedrock.Identity.passcodeSent',
  // email for owner
  template: 'bedrock.Identity.passcodeSent'
});

var ids = [
  'bedrock.Identity.passcodeSent'
];
ids.forEach(function(id) {
  config.mail.templates.config[id] = {
    filename: path.join(__dirname, '..', 'email-templates', id + '.tpl')
  };
});

// tests
config.mocha.tests.push(path.join(__dirname, '..', 'tests'));
