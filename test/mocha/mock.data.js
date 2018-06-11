/*
 * Copyright (c) 2015-2018 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

const helpers = require('./helpers');

const data = {};
module.exports = data;

const identities = data.identities = {};

let userName;

// regular permissions
userName = 'alpha';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].meta = {};
identities[userName].meta.sysResourceRole = [{
  sysRole: 'bedrock-identity.regular',
  generateResource: 'id'
}];

// admin permissions
userName = 'admin';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].meta = {};
identities[userName].meta.sysResourceRole = [{
  sysRole: 'bedrock-identity.admin'
}];

// no permissions
userName = 'gamma';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].meta = {};

// regular permissions
userName = 'will-b-disabled';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].meta = {};
identities[userName].meta.sysResourceRole = [{
  sysRole: 'bedrock-identity.regular',
  generateResource: 'id'
}];
