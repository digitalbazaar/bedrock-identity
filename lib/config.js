/*
 * Bedrock Identity Module Configuration.
 *
 * Copyright (c) 2012-2016 Digital Bazaar, Inc. All rights reserved.
 */
var config = require('bedrock').config;
var fs = require('fs');
var path = require('path');
require('bedrock-permission');

config.identity = {};

/**
 * An extendable list of accepted fields for each identity model
 */
config.identity.fields = [
  'identity.description',
  'identity.image',
  'identity.label',
  'identity.memberOf',
  'identity.sysGravatarType',
  'identity.sysImageType',
  'identity.sysPublic',
  'identity.sysSigningKey',
  'identity.url'
];

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
// TODO: deprecate IDENTITY_ADMIN; permissions should be narrowly tailored for
// and named after actions
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
permissions.IDENTITY_INSERT = {
  id: 'IDENTITY_INSERT',
  label: 'Insert Identity',
  comment: 'Required to insert an Identity.'
};
permissions.IDENTITY_EDIT = {
  id: 'IDENTITY_EDIT',
  label: 'Edit Identity',
  comment: 'Required to edit an Identity.'
};
permissions.IDENTITY_UPDATE_MEMBERSHIP = {
  id: 'IDENTITY_UPDATE_MEMBERSHIP',
  label: 'Update Membership',
  comment: 'Required to update membership in groups.'
};
permissions.IDENTITY_REMOVE = {
  id: 'IDENTITY_REMOVE',
  label: 'Remove Identity',
  comment: 'Required to remove an Identity.'
};
permissions.IDENTITY_DELEGATE_CAPABILITY = {
  id: 'IDENTITY_DELEGATE_CAPABILITY',
  label: 'Delegate Capability',
  comment: 'Required to delegate capabilities to other identities.'
};
