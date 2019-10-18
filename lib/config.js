/*
 * Copyright (c) 2012-2018 Digital Bazaar, Inc. All rights reserved.
 */
const {config} = require('bedrock');
require('bedrock-permission');

config.identity = {};

// permissions
const {permissions} = config.permission;
permissions.IDENTITY_ACCESS = {
  id: 'IDENTITY_ACCESS',
  label: 'Access Identity',
  comment: 'Required to access an Identity.'
};
permissions.IDENTITY_CAPABILITY_DELEGATE = {
  id: 'IDENTITY_CAPABILITY_DELEGATE',
  label: 'Delegate Capability',
  comment: 'Required to delegate capabilities to other identities.'
};
permissions.IDENTITY_CAPABILITY_REVOKE = {
  id: 'IDENTITY_CAPABILITY_REVOKE',
  label: 'Revoke Capability',
  comment: 'Required to revoke capabilities from other identities. When this ' +
    'permission is associated with a resource to create a revocation ' +
    'capability, it means that any actor with that revocation capability ' +
    'may revoke any capability from any identity that is associated with ' +
    'the same resource.'
};
permissions.IDENTITY_INSERT = {
  id: 'IDENTITY_INSERT',
  label: 'Insert Identity',
  comment: 'Required to insert an Identity.'
};
permissions.IDENTITY_META_UPDATE = {
  id: 'IDENTITY_META_UPDATE',
  label: 'Update Identity Meta',
  comment: 'Required to update Identity metadata.'
};
permissions.IDENTITY_REMOVE = {
  id: 'IDENTITY_REMOVE',
  label: 'Remove Identity',
  comment: 'Required to remove an Identity.'
};
permissions.IDENTITY_UPDATE = {
  id: 'IDENTITY_UPDATE',
  label: 'Update Identity',
  comment: 'Required to update an Identity.'
};
permissions.IDENTITY_UPDATE_MEMBERSHIP = {
  id: 'IDENTITY_UPDATE_MEMBERSHIP',
  label: 'Update Membership',
  comment: 'Required to update membership in groups.'
};
