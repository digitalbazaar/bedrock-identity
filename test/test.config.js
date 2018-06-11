/*
 * Copyright (c) 2012-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const path = require('path');
require('bedrock-permission');

const {permissions, roles} = config.permission;

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
    permissions.IDENTITY_UPDATE.id,
    permissions.IDENTITY_INSERT.id,
    permissions.IDENTITY_UPDATE_MEMBERSHIP.id,
    permissions.IDENTITY_CAPABILITY_DELEGATE.id,
    permissions.IDENTITY_CAPABILITY_REVOKE.id
  ]
};
roles['bedrock-identity.admin'] = {
  id: 'bedrock-identity.admin',
  label: 'Identity Test Role',
  comment: 'Role for Admin User',
  sysPermission: [
    permissions.IDENTITY_ACCESS.id,
    permissions.IDENTITY_UPDATE.id,
    permissions.IDENTITY_INSERT.id,
    permissions.IDENTITY_REMOVE.id,
    permissions.IDENTITY_META_UPDATE.id,
    permissions.IDENTITY_UPDATE_MEMBERSHIP.id,
    permissions.IDENTITY_CAPABILITY_DELEGATE.id,
    permissions.IDENTITY_CAPABILITY_REVOKE.id
  ]
};
