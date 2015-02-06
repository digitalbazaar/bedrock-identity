/*
 * Bedrock Identity Module Configuration.
 *
 * Copyright (c) 2012-2015 Digital Bazaar, Inc. All rights reserved.
 */
var config = require('bedrock').config;
var fs = require('fs');
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

var constants = config.constants;

/**
 * Load a local copy of identity v1 context.
 */
constants.IDENTITY_CONTEXT_V1_URL = 'https://w3id.org/identity/v1';
constants.CONTEXTS[constants.IDENTITY_CONTEXT_V1_URL] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../contexts/identity-v1.jsonld'),
    {encoding: 'utf8'}));

/**
 * Load local copy of security v1 context.
 */
constants.SECURITY_CONTEXT_V1_URL = 'https://w3id.org/security/v1';
constants.CONTEXTS[constants.SECURITY_CONTEXT_V1_URL] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../contexts/security-v1.jsonld'),
    {encoding: 'utf8'}));

// tests
config.mocha.tests.push(path.join(__dirname, '..', 'tests'));
