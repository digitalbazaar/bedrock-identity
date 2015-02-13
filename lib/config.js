/*
 * Bedrock Identity Module Configuration.
 *
 * Copyright (c) 2012-2015 Digital Bazaar, Inc. All rights reserved.
 */
var config = require('bedrock').config;
var fs = require('fs');
var path = require('path');
require('bedrock-mail');
require('bedrock-permission');

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

// default mail setup, should be overridden
config.mail.vars = {
  // could be set to config.views.vars.productionMode,
  productionMode: false,
  baseUri: config.server.baseUri,
  subject: {
    prefix: '[Bedrock] ',
    identityPrefix: '[Bedrock] '
  },
  service: {
    name: 'Bedrock',
    host: config.server.host
  },
  system: {
    name: 'System',
    email: 'cluster@' + config.server.domain
  },
  support: {
    name: 'Customer Support',
    email: 'support@' + config.server.domain
  },
  registration: {
    email: 'registration@' + config.server.domain
  },
  comments: {
    email: 'comments@' + config.server.domain
  },
  machine: require('os').hostname()
};

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

// permissions
var permissions = config.permission.permissions;
permissions.IDENTITY_ADMIN = {
  id: 'IDENTITY_ADMIN',
  label: 'Identity Administration',
  comment: 'Required to administer Identities.'
};
permissions.IDENTITY_ACCESS = {
  id: 'IDENTITY_ACCESS',
  label: 'Access Identity',
  comment: 'Required to access an Identity.'
};
permissions.IDENTITY_CREATE = {
  id: 'IDENTITY_CREATE',
  label: 'Create Identity',
  comment: 'Required to create an Identity.'
};
permissions.IDENTITY_EDIT = {
  id: 'IDENTITY_EDIT',
  label: 'Edit Identity',
  comment: 'Required to edit an Identity.'
};
permissions.IDENTITY_REMOVE = {
  id: 'IDENTITY_REMOVE',
  label: 'Remove Identity',
  comment: 'Required to remove an Identity.'
};
permissions.PUBLIC_KEY_CREATE = {
  id: 'PUBLIC_KEY_CREATE',
  label: 'Create Public Key',
  comment: 'Required to create a Public Key.'
};
permissions.PUBLIC_KEY_REMOVE = {
  id: 'PUBLIC_KEY_REMOVE',
  label: 'Remove Public Key',
  comment: 'Required to remove a Public Key.'
};

// tests
config.mocha.tests.push(path.join(__dirname, '..', 'tests'));
