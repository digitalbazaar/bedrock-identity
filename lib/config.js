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
 * Load local copy of security contexts.
 */
constants.SECURITY_CONTEXT_V1_URL = 'https://w3id.org/security/v1';
constants.CONTEXTS[constants.SECURITY_CONTEXT_V1_URL] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../contexts/security-v1.jsonld'),
    {encoding: 'utf8'}));
constants.SECURITY_CONTEXT_V2_URL = 'https://w3id.org/security/v2';
constants.CONTEXTS[constants.SECURITY_CONTEXT_V2_URL] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../contexts/security-v2.jsonld'),
    {encoding: 'utf8'}));

// permissions
var permissions = config.permission.permissions;
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
