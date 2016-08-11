/*
 * Bedrock Identity Module Test Configuration.
 *
 * Copyright (c) 2012-2016 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var path = require('path');

var permissions = config.permission.permissions;
var roles = config.permission.roles;

config.mocha.tests.push(path.join(__dirname, 'mocha'));

// mongodb config
config.mongodb.name = 'bedrock_identity_test';
config.mongodb.host = 'localhost';
config.mongodb.port = 27017;
config.mongodb.local.collection = 'bedrock_identity_test';
// drop all collections on initialization
config.mongodb.dropCollections = {};
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

roles['bedrock-identity.regular'] = {
  id: 'bedrock-identity.regular',
  label: 'Identity Test Role',
  comment: 'Role for Test User',
  sysPermission: [
    permissions.IDENTITY_ACCESS.id,
    permissions.IDENTITY_EDIT.id
  ]
};
roles['bedrock-identity.admin'] = {
  id: 'bedrock-identity.admin',
  label: 'Identity Test Role',
  comment: 'Role for Admin User',
  sysPermission: [
    permissions.IDENTITY_ACCESS.id,
    permissions.IDENTITY_ADMIN.id,
    permissions.IDENTITY_EDIT.id,
    permissions.IDENTITY_INSERT.id,
    permissions.IDENTITY_REMOVE.id
  ]
};
