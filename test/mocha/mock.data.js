/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

var helpers = require('./helpers');

var data = {};
module.exports = data;

var identities = data.identities = {};

var userName;

// regular permissions
userName = 'alpha';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].identity.sysResourceRole.push({
  sysRole: 'bedrock-identity.regular',
  generateResource: 'id'
});

// admin permissions
userName = 'admin';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].identity.sysResourceRole.push({
  sysRole: 'bedrock-identity.admin'
});

// no permissions
userName = 'gamma';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);

// regular permissions
var userName = 'will-b-disabled';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].identity.sysResourceRole.push({
  sysRole: 'bedrock-identity.regular',
  generateResource: 'id'
});
