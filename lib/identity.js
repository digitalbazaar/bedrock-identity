/*
 * Bedrock Identity module.
 *
 * Copyright (c) 2012-2015 Digital Bazaar, Inc. All rights reserved.
 */
var async = require('async');
var bcrypt = require('bcrypt');
var bedrock = require('bedrock');
var bedrockPermission = require('bedrock-permission');
var database = require('bedrock-mongodb');
var jsigs = require('jsonld-signatures');
var mail = require('bedrock-mail');
var ursa = require('ursa');
var util = require('util');
var BedrockError = bedrock.util.BedrockError;

// load config defaults
require('./config');

// configure jsigs using local bedrock jsonld instance; will load
// contexts from local config when available
jsigs = jsigs({}, {
  inject: {jsonld: bedrock.jsonld}
});

// module permissions
var PERMISSIONS = bedrock.config.permission.permissions;

// module API
var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock-mongodb.ready', init);

function init(callback) {
  // do initialization work
  async.waterfall([
    function(callback) {
      // open all necessary collections
      database.openCollections(['identity', 'publicKey'], callback);
    },
    function(callback) {
      // setup collections (create indexes, etc)
      database.createIndexes([{
        collection: 'identity',
        fields: {id: 1},
        options: {unique: true, background: false}
      }, {
        collection: 'identity',
        fields: {'identity.sysSlug': 1},
        options: {unique: true, background: false}
      }, {
        collection: 'identity',
        fields: {'identity.email': 1},
        options: {unique: false, background: false}
      }, {
      // TODO: add identityGroup index?
        collection: 'publicKey',
        fields: {id: 1},
        options: {unique: true, background: false}
      }, {
        collection: 'publicKey',
        fields: {owner: 1, pem: 1},
        options: {unique: true, background: false}
      }], callback);
    },
    function(callback) {
      // create identities, ignoring duplicate errors
      async.forEachSeries(
        bedrock.config.identity.identities,
        function(i, callback) {
          _createIdentity(i, function(err) {
            if(err && database.isDuplicateError(err)) {
              err = null;
            }
            callback(err);
          });
        },
        callback);
    },
    function(callback) {
      // add keys, ignoring duplicate errors
      async.forEachSeries(
        bedrock.config.identity.keys,
        function(i, callback) {
          var publicKey = i.publicKey;
          var privateKey = i.privateKey || null;
          _addIdentityPublicKey(publicKey, privateKey, function(err) {
            if(err && database.isDuplicateError(err)) {
              err = null;
            }
            callback(err);
          });
        }, callback);
    },
    function(callback) {
      mail.registerTrigger('getIdentity', function(event, callback) {
        api.getIdentity(
          null, event.details.identityId, function(err, identity) {
          if(!err) {
            event.details.identity = identity;
          }
          callback(err);
        });
      });
      callback();
    }
  ], callback);
}

/**
 * Creates an Identity ID from the given name.
 *
 * @param name the short identity name (slug).
 *
 * @return the Identity ID for the Identity.
 */
api.createIdentityId = function(name) {
  return util.format('%s%s/%s',
    bedrock.config.server.baseUri,
    bedrock.config.identity.basePath,
    encodeURIComponent(name));
};

/**
 * Gets the Identity ID(s) that match the given email address.
 *
 * @param email the email address.
 * @param callback(err, identityIds) called once the operation completes.
 */
api.resolveEmail = function(email, callback) {
  database.collections.identity.find(
    {'identity.email': email},
    {'identity.id': true}).toArray(function(err, records) {
    if(records) {
      records.forEach(function(record, i) {
        records[i] = record.identity.id;
      });
    }
    callback(err, records);
  });
};

/**
 * Gets the Identity ID that matches the given identity name (ID or slug). The
 * Identity ID will be null if none is found. If a full identity ID is passed,
 * it will be passed back in the callback if it is valid.
 *
 * @param name the identity name (ID or slug).
 * @param callback(err, identityId) called once the operation completes.
 */
api.resolveIdentitySlug = function(name, callback) {
  database.collections.identity.findOne(
    {$or: [{id: database.hash(name)}, {'identity.sysSlug': name}]},
    {'identity.id': true},
    function(err, result) {
      if(!err && result) {
        result = result.identity.id;
      }
      callback(err, result);
    });
};

/**
 * Gets the Identity IDs that match the given identifier. The identifier
 * can be an Identity ID, an Identity slug, or an email address.
 *
 * @param identifier the identifier to resolve.
 * @param callback(err, identityIds) called once the operation completes.
 */
api.resolveIdentityIdentifier = function(identifier, callback) {
  // looks like an email
  if(identifier.indexOf('@') !== -1) {
    return api.resolveEmail(identifier, callback);
  }
  // must be an identity or slug
  api.resolveIdentitySlug(identifier, function(err, identityId) {
    if(err) {
      return callback(err);
    }
    if(!identityId) {
      return callback(null, []);
    }
    // arrayify result
    callback(null, [identityId]);
  });
};

/**
 * Creates a new Identity.
 *
 * The Identity must contain id and an owner.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity containing at least the minimum required data.
 * @param callback(err, record) called once the operation completes.
 */
api.createIdentity = function(actor, identity, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_CREATE, {resource: identity}, callback);
    },
    function(callback) {
      _createIdentity(identity, callback);
    }
  ], callback);
};

/**
 * Retrieves all Identities matching the given query.
 *
 * @param actor the Identity performing the action.
 * @param [query] the optional query to use (default: {}).
 * @param [fields] optional fields to include or exclude (default: {}).
 * @param [options] options (eg: 'sort', 'limit').
 * @param callback(err, records) called once the operation completes.
 */
api.getIdentities = function(actor, query, fields, options, callback) {
  // handle args
  if(typeof query === 'function') {
    callback = query;
    query = null;
    fields = null;
  } else if(typeof fields === 'function') {
    callback = fields;
    fields = null;
  } else if(typeof options === 'function') {
    callback = options;
    options = null;
  }

  query = query || {};
  fields = fields || {};
  options = options || {};
  async.waterfall([
    function(callback) {
      api.checkPermission(actor, PERMISSIONS.IDENTITY_ADMIN, callback);
    },
    function(callback) {
      database.collections.identity.find(
        query, fields, options).toArray(callback);
    }
  ], callback);
};

/**
 * Retrieves an Identity.
 *
 * @param actor the Identity performing the action.
 * @param id the ID of the Identity to retrieve.
 * @param callback(err, identity, meta) called once the operation completes.
 */
api.getIdentity = function(actor, id, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS, {resource: id}, callback);
    },
    function(callback) {
      database.collections.identity.findOne(
        {id: database.hash(id)}, {}, callback);
    },
    function(record, callback) {
      if(!record) {
        return callback(new BedrockError(
          'Identity not found.',
          'NotFound',
          {id: id, httpStatusCode: 404, 'public': true}));
      }
      // remove restricted fields
      delete record.identity.sysPassword;
      delete record.identity.sysPasscode;
      callback(null, record.identity, record.meta);
    }
  ], callback);
};

/**
 * Updates an Identity. Only specific information contained in the passed
 * Identity will be updated. Restricted fields can not be updated in this
 * call, and may have their own API calls.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity to update.
 * @param callback(err) called once the operation completes.
 */
api.updateIdentity = function(actor, identity, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: identity}, callback);
    },
    function(callback) {
      // TODO: use 'include' instead and only whitelist fields that can change
      // via this API, particularly because other modules may extend what is
      // stored in an identity and those fields shouldn't be changed here
      // exclude restricted fields
      var update = database.buildUpdate(
        identity, 'identity', {exclude: [
          'identity.sysSlug', 'identity.sysStatus',
          'identity.sysPassword', 'identity.sysPasswordNew',
          'identity.sysPasscode', 'identity.sysRole']});
      // TODO: optimize to only require if email actually changes?
      // if updating email, require verification again
      if('identity.email' in update) {
        update['identity.sysEmailVerified'] = false;
      }
      database.collections.identity.update(
        {id: database.hash(identity.id)},
        {$set: update}, database.writeOptions, callback);
    },
    function(result, callback) {
      if(result.result.n === 0) {
        return callback(new BedrockError(
          'Could not update Identity. Identity not found.',
          'NotFound'));
      }
      callback();
    }
  ], callback);
};

/**
 * Sets an Identity's status.
 *
 * @param actor the Identity performing the action.
 * @param id the Identity ID.
 * @param status the status.
 * @param callback(err) called once the operation completes.
 */
api.setIdentityStatus = function(actor, id, status, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(actor, PERMISSIONS.IDENTITY_ADMIN, callback);
    },
    function(callback) {
      database.collections.identity.update(
        {id: database.hash(id)},
        {$set: {'identity.sysStatus': status}},
        database.writeOptions,
        callback);
    },
    function(result, callback) {
      if(result.result.n === 0) {
        return callback(new BedrockError(
          'Could not set Identity status. Identity not found.',
          'NotFound'));
      }
      callback();
    }
  ], callback);
};

/**
 * Sets an Identity's password. This method can optionally check an old password
 * or passcode and will always generate a new passcode and set it as
 * 'sysPasscode'. A new password doesn't have to be set using this method, it
 * can be called to simply generate a new passcode. If 'sysPassword' is
 * provided, it must be the old password and it will be checked. The same
 * applies to 'sysPasscode'. If a new password is to be set, it should be
 * passed as 'sysPasswordNew'.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity.
 * @param callback(err, changes) called once the operation completes.
 */
api.setIdentityPassword = function(actor, identity, callback) {
  var changes = {};
  async.auto({
    checkPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: identity}, callback);
    },
    checkPassword: ['checkPermission', function(callback) {
      if('sysPassword' in identity) {
        return api.verifyIdentityPassword(identity, callback);
      }
      callback(null, null);
    }],
    checkPasscode: ['checkPermission', function(callback) {
      if('sysPasscode' in identity) {
        return api.verifyIdentityPasscode(identity, callback);
      }
      callback(null, null);
    }],
    hashPassword: ['checkPassword', 'checkPasscode', function(
      callback, results) {
      if(results.checkPassword === false) {
        return callback(new BedrockError(
          'Could not update identity password; invalid password.',
          'InvalidPassword'));
      }
      if(results.checkPasscode === false) {
        return callback(new BedrockError(
          'Could not update identity passcode; invalid passcode.',
          'InvalidPasscode'));
      }
      if('sysPasswordNew' in identity) {
        return api.createPasswordHash(identity.sysPasswordNew, callback);
      }
      callback();
    }],
    generatePasscode: ['hashPassword', function(callback, results) {
      if(results.hashPassword) {
        changes.sysPassword = results.hashPassword;
      }
      var passcode = identity.sysPasscode = _generatePasscode();
      api.createPasswordHash(passcode, callback);
    }],
    update: ['generatePasscode', function(callback, results) {
      changes.sysPasscode = results.generatePasscode;
      database.collections.identity.update(
        {id: database.hash(identity.id)},
        {$set: database.buildUpdate(changes, 'identity')},
        database.writeOptions,
        function(err, result) {
          if(err) {
            return callback(err);
          }
          if(result.result.n === 0) {
            return callback(new BedrockError(
              'Could not set Identity password. Identity not found.',
              'NotFound'));
          }
          callback();
        });
    }]
  }, function(err) {
    callback(err, changes);
  });
};

/**
 * Verifies the Identity's password against the stored password.
 *
 * @param identity the Identity with the password to verify.
 * @param callback(err, verified) called once the operation completes.
 */
api.verifyIdentityPassword = function(identity, callback) {
  _verifyIdentityPasswordHash(identity, 'password', callback);
};

/**
 * Verifies the Identity's passcode against the stored passcode.
 *
 * @param identity the Identity with the passcode to verify.
 * @param callback(err, verified) called once the operation completes.
 */
api.verifyIdentityPasscode = function(identity, callback) {
  _verifyIdentityPasswordHash(identity, 'passcode', callback);
};

/**
 * Verifies the Identity's passcode against the stored passcode and sets
 * the Identity's email address as verified upon success.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity with the passcode to verify.
 * @param callback(err, verified) called once the operation completes.
 */
api.verifyIdentityEmail = function(actor, identity, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: identity}, callback);
    },
    function(callback) {
      _verifyIdentityPasswordHash(identity, 'passcode', callback);
    },
    function(verified, callback) {
      if(!verified) {
        return callback(null, verified);
      }
      database.collections.identity.update(
        {id: database.hash(identity.id)},
        {$set: {'identity.sysEmailVerified': true}},
        database.writeOptions, function(err) {
          callback(err, verified);
      });
    }
  ], callback);
};

/**
 * Sends an Identity's or multiple Identity's passcodes to their contact point
 * (eg: email address). The Identities must all have the same contact point and
 * must be populated.
 *
 * @param identities the Identities to send the passcode to.
 * @param usage 'reset' if the passcode is for resetting a password,
 *          'verify' if it is for verifying an email address/contact point.
 * @param callback(err) called once the operation completes.
 */
api.sendIdentityPasscodes = function(identities, usage, callback) {
  // FIXME: require actor and check permissions to send email/sms/etc?

  // create event
  var event = {
    type: 'bedrock.Identity.passcodeSent',
    details: {
      usage: usage,
      identities: [],
      email: null
    }
  };

  // generate passcodes for every identity
  async.forEach(identities, function(identity, callback) {
    // remove password and passcode from identity; this prevents checking
    // passwords/passcodes and only generates a new passcode
    identity = bedrock.util.clone(identity);
    delete identity.sysPassword;
    delete identity.sysPasscode;
    api.setIdentityPassword(null, identity, function(err) {
      if(err) {
        return callback(err);
      }
      event.details.identities.push(identity);
      if(!event.details.email) {
        event.details.email = identity.email;
      } else if(event.details.email !== identity.email) {
        return callback(new BedrockError(
          'Could not send Identity passcodes. The identities do not all ' +
          'have the same contact point (eg: email address).',
          'ContactPointMismatch'));
      }
      callback();
    });
  }, function(err) {
    if(err) {
      return callback(err);
    }

    // emit passcode sent event
    bedrock.events.emitLater(event);
    // TODO: limit # emails sent per identity per day
    // TODO: use job scheduler for this?
    callback();
  });
};

/**
 * Creates a password hash that can be stored and later used to verify a
 * password at a later point in time.
 *
 * @param password the password to hash.
 * @param callback(err, hash) called once the operation completes.
 */
api.createPasswordHash = function(password, callback) {
  bcrypt.genSalt(function(err, salt) {
    if(err) {
      return callback(err);
    }
    bcrypt.hash(password, salt, function(err, hash) {
      callback(err, 'bcrypt:' + hash);
    });
  });
};

/**
 * Verifies a password against a previously generated password hash. The
 * hash value should have been generated via createPasswordHash() or by
 * a supported legacy method.
 *
 * @param hash the hash value to verify against.
 * @param password the password to verify.
 * @param callback(err, verified, legacy) called once the operation completes.
 */
api.verifyPasswordHash = function(hash, password, callback) {
  var fields = hash.split(':');
  if(fields.length !== 2 && fields.length !== 3) {
    return callback(new BedrockError(
      'Could not verify password hash. Invalid input.',
      'MalformedPasswordHash'));
  }
  // bcrypt hash
  if(fields[0] === 'bcrypt') {
    return bcrypt.compare(password, fields[1], function(err, verified) {
      callback(err, verified, false);
    });
  }
  // unknown algorithm
  callback(new BedrockError(
    'Could not verify password hash. Invalid input.',
    'MalformedPasswordHash'));
};

/**
 * Sets the Identity's ResourceRoles from the identity['sysResourceRole'] array.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity that is being updated.
 * @param callback(err) called once the operation completes.
 */
api.setIdentityRoles = function(actor, identity, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ADMIN, {resource: identity}, callback);
    },
    function(callback) {
      database.collections.identity.update(
        {id: database.hash(identity.id)},
        {$set: {'identity.sysRole': identity.sysRole}},
        database.writeOptions,
        function(err) {
          callback(err);
        });
    }
  ], callback);
};

/**
 * Checks to see if an actor has been granted a permission to some resource.
 * This method is a passthrough to the permission module's 'checkPermission'
 * call, but it takes an actor instead of a permission table, and it will
 * create and cache the actor's permission table as needed.
 *
 * @param actor the Identity that wants to act, if null or undefined is
 *          given, permission will be granted.
 * @param permission the permission to check.
 * @param options the options to use, see: bedrock-permission.checkPermission.
 * @param callback(err, [identifiers]) called once the operation completes.
 */
api.checkPermission = function(actor, permission, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  // actor is undefined, deny permission
  if(typeof actor === 'undefined') {
    return callback(new BedrockError(
      'Permission denied; no actor specified.',
      'PermissionDenied', {public: true}));
  }

  // grant permission; actor is null (NOT undefined) (full admin mode)
  if(actor === null) {
    if(options.returnIds) {
      return callback(null, []);
    }
    return callback(null);
  }

  // TODO: including the actor in the options isn't the cleanest design;
  // perhaps permission checking functionality should just all be moved here

  // include actor in options
  if(!('actor' in options)) {
    options.actor = actor;
  }

  async.auto({
    getActorRoles: function(callback) {
      // permission table already built, do not need to fetch roles
      if(actor.sysPermissionTable) {
        return callback();
      }
      database.collections.identity.findOne(
        {id: database.hash(actor.id)}, {'identity.sysResourceRole': true},
        function(err, result) {
          if(err) {
            return callback(err);
          }
          if(!result) {
            return callback(null, []);
          }
          callback(null, result.identity.sysResourceRole);
        });
    },
    cacheTable: ['getActorRoles', function(callback, results) {
      // already cached
      if(actor.sysPermissionTable) {
        return callback(null, actor.sysPermissionTable);
      }
      bedrockPermission.createPermissionTable(
        results.getActorRoles, callback);
    }],
    checkPermission: ['cacheTable', function(callback, results) {
      actor.sysPermissionTable = results.cacheTable;
      bedrockPermission.checkPermission(
        actor.sysPermissionTable, permission, options, callback);
    }]
  }, function(err, results) {
    if(options.returnIds) {
      return callback(err, results.checkPermission);
    }
    callback(err);
  });
};

/**
 * Creates a PublicKeyId from the given IdentityId and key name.
 *
 * @param ownerId the identity ID of the owner of the key.
 * @param name the name of the key.
 *
 * @return the PublicKey ID created from the ownerId and keyName.
 */
api.createIdentityPublicKeyId = function(ownerId, name) {
  return util.format('%s/keys/%s', ownerId, encodeURIComponent(name));
};

/**
 * Adds a new PublicKey to the Identity.
 *
 * @param actor the Identity performing the action.
 * @param publicKey the publicKey to add, with no ID yet set.
 * @param privateKey the privateKey that is paired with the publicKey,
 *          only provided if it is to be stored on the server.
 * @param callback(err, record) called once the operation completes.
 */
api.addIdentityPublicKey = function(actor, publicKey, privateKey, callback) {
  if(typeof privateKey === 'function') {
    callback = privateKey;
    privateKey = null;
  }
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.PUBLIC_KEY_CREATE,
        {resource: publicKey, translate: 'owner'}, callback);
    },
    function(callback) {
      _addIdentityPublicKey(publicKey, privateKey, callback);
    }
  ], callback);
};

/**
 * Retrieves an Identity's PublicKey.
 *
 * @param publicKey the PublicKey with 'id' or both 'owner' and
 *          'publicKeyPem' set.
 * @param actor the Identity performing the action (if not undefined, an
 *          attempt to get the private key will also be made).
 * @param callback(err, publicKey, meta, privateKey) called once the
 *          operation completes.
 */
api.getIdentityPublicKey = function(publicKey, actor, callback) {
  if(typeof actor === 'function') {
    callback = actor;
    actor = undefined;
  }
  async.waterfall([
    function(callback) {
      var query = {};
      if('id' in publicKey) {
        query.id = database.hash(publicKey.id);
      } else {
        query.owner = database.hash(publicKey.owner);
        query.pem = database.hash(publicKey.publicKeyPem);
      }
      database.collections.publicKey.findOne(query, {}, callback);
    },
    function(record, callback) {
      // no such public key
      if(!record) {
        return callback(new BedrockError(
          'PublicKey not found.',
          'NotFound',
          {key: publicKey}));
      }
      var privateKey = record.publicKey.privateKey || null;
      delete record.publicKey.privateKey;
      return callback(null, record.publicKey, record.meta, privateKey);
    },
    function(publicKey, meta, privateKey, callback) {
      if(actor === undefined) {
        return callback(null, publicKey, meta, privateKey);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS,
        {resource: publicKey, translate: 'owner'},
        function(err) {
          callback(err, publicKey, meta, privateKey);
        });
    }
  ], callback);
};

/**
 * Retrieves an Identity's PublicKey(s).
 *
 * @param id the ID of the identity to get the PublicKeys for.
 * @param actor the Identity performing the action (if not undefined, an
 *          attempt to get the private key will also be made).
 * @param callback(err, records) called once the operation completes.
 */
api.getIdentityPublicKeys = function(id, actor, callback) {
  if(typeof actor === 'function') {
    callback = actor;
    actor = undefined;
  }
  async.waterfall([
    function(callback) {
      database.collections.publicKey.find(
        {owner: database.hash(id)}, {}).toArray(callback);
    },
    function(records, callback) {
      if(actor === undefined) {
        return callback(null, records);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS,
        {resource: id}, function(err) {
          callback(err, records);
        });
    },
    function(records, callback) {
      // remove private keys if no actor was provided
      if(actor === undefined) {
        records.forEach(function(record) {
          delete record.publicKey.privateKey;
        });
      }
      callback(null, records);
    }
  ], callback);
};

/**
 * Updates descriptive data for a PublicKey.
 *
 * @param actor the Identity performing the action.
 * @param publicKey the publicKey to update.
 * @param callback(err) called once the operation completes.
 */
api.updateIdentityPublicKey = function(actor, publicKey, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {
          resource: publicKey,
          translate: 'owner',
          get: _getPublicKeyForPermissionCheck
        }, callback);
    },
    function(callback) {
      // exclude restricted fields
      database.collections.publicKey.update(
        {id: database.hash(publicKey.id)},
        {$set: database.buildUpdate(
          publicKey, 'publicKey', {exclude: [
            'publicKey.sysStatus', 'publicKey.publicKeyPem',
            'publicKey.owner']})},
        database.writeOptions,
        callback);
    },
    function(result, callback) {
      if(result.result.n === 0) {
        return callback(new BedrockError(
          'Could not update public key. Public key not found.',
          'NotFound'));
      }
      callback();
    }
  ], callback);
};

/**
 * Revokes a PublicKey.
 *
 * @param actor the Identity performing the action.
 * @param publicKeyId the ID of the publicKey to revoke.
 * @param callback(err, key) called once the operation completes.
 */
api.revokeIdentityPublicKey = function(actor, publicKeyId, callback) {
  async.waterfall([
    function(callback) {
      api.getIdentityPublicKey({id: publicKeyId},
        function(err, publicKey, meta, privateKey) {
          if(privateKey) {
            publicKey.privateKey = privateKey;
          }
          callback(err, publicKey);
        });
    },
    function(publicKey, callback) {
      api.checkPermission(
        actor, PERMISSIONS.PUBLIC_KEY_REMOVE,
        {resource: publicKey, translate: 'owner'}, function(err) {
          callback(err, publicKey);
        });
    },
    function(publicKey, callback) {
      // set status to disabled, add revocation date
      var revokedDate = bedrock.util.w3cDate();
      publicKey.sysStatus = 'disabled';
      publicKey.revoked = revokedDate;
      var update = {
        $set: {
          'publicKey.sysStatus': publicKey.sysStatus,
          'publicKey.revoked': publicKey.revoked
        }
      };
      // revoke private key as well if present
      if('privateKey' in publicKey) {
        publicKey.privateKey.sysStatus = 'disabled';
        publicKey.privateKey.revoked = revokedDate;
        update.$set['publicKey.privateKey.sysStatus'] =
          publicKey.privateKey.sysStatus;
        update.$set['publicKey.privateKey.revoked'] =
          publicKey.privateKey.revoked;
      }
      database.collections.publicKey.update(
        {id: database.hash(publicKeyId), 'publicKey.sysStatus': 'active'},
        update,
        database.writeOptions, function(err, result) {
          callback(err, result, publicKey);
        });
    },
    function(result, publicKey, callback) {
      if(result.result.n === 0) {
        return callback(new BedrockError(
          'Could not revoke public key. Public key not found or already ' +
          'revoked.',
          'NotFound'));
      }
      callback(null, publicKey);
    }
  ], callback);
};

/**
 * Sign JSON-LD with identity service owner key.
 *
 * @param obj the JSON-LD object to sign.
 * @param options the options to use:
 *   [date] an optional date to override the signature date with.
 *   [domain] an optional domain to include in the signature.
 *   [nonce] an optional nonce to include in the signature.
 * @param callback(err, output) called once the operation completes.
 */
api.signJsonLdAsIdentityService = function(obj, options, callback) {
  async.waterfall([
    function(callback) {
      // get identity service owner identity
      var owner = bedrock.config.identity.owner;
      api.getIdentity(null, owner, function(err, ownerIdentity) {
        callback(err, ownerIdentity);
      });
    },
    function(ownerIdentity, callback) {
      _getSigningKey(ownerIdentity, callback);
    },
    function(publicKey, callback) {
      // setup options
      var privateKey = publicKey.privateKey;
      var _options = {
        privateKeyPem: privateKey,
        creator: publicKey.id
      };
      if('date' in options) {
        _options.date = options.date;
      }
      if('domain' in options) {
        _options.domain = options.domain;
      }
      if('nonce' in options) {
        _options.nonce = options.nonce;
      }
      // do the signature
      jsigs.sign(obj, _options, callback);
    }
  ], callback);
};

/**
 * Try to get a signing key. First try the identity sysSigningKey. Fallback to
 * the first found key with private key data.
 *
 * @param identity the identity of the signer.
 * @param callback(err, signingKey) called once the operation completes.
 */
function _getSigningKey(identity, callback) {
  var sysSigningKey = identity.sysSigningKey;
  if(sysSigningKey) {
    // key id found, get and return the key
    return api.getIdentityPublicKey({
      id: sysSigningKey
    }, function(err, publicKey, meta, privateKey) {
      if(err) {
        return callback(err);
      }
      publicKey.privateKey = privateKey;
      return callback(null, publicKey);
    });
  }

  // get all keys and return first one with private key
  api.getIdentityPublicKeys(identity.id, null, function(err, records) {
    for(var i = 0; i < records.length; ++i) {
      var key = records[i].publicKey;
      if('privateKey' in key) {
        return callback(null, key);
      }
    }
    callback(new BedrockError(
      'Signing key not found.',
      'NotFound'));
  });
}

/**
 * Gets an Identity during a permission check.
 *
 * @param identity the Identity to get.
 * @param options the options to use.
 * @param callback(err, identity) called once the operation completes.
 */
function _getIdentityForPermissionCheck(identity, options, callback) {
  if(typeof identity === 'object') {
    identity = identity.id || '';
  }
  api.getIdentity(null, identity, function(err, identity) {
    callback(err, identity);
  });
}

/**
 * Gets a PublicKey during a permission check.
 *
 * @param publicKey the PublicKey to get.
 * @param options the options to use.
 * @param callback(err, publicKey) called once the operation completes.
 */
function _getPublicKeyForPermissionCheck(publicKey, options, callback) {
  if(typeof publicKey === 'string') {
    publicKey = {id: publicKey || ''};
  }
  api.getIdentityPublicKey(null, publicKey, function(err, publicKey) {
    callback(err, publicKey);
  });
}

/**
 * Creates a new identity, inserting it into the database.
 *
 * @param identity the identity to create.
 * @param callback(err, record) called once the operation completes.
 */
function _createIdentity(identity, callback) {
  async.auto({
    checkDuplicate: function(callback) {
      // check for a duplicate to prevent generating password hashes
      database.collections.identity.findOne(
        {'identity.sysSlug': identity.sysSlug}, {'identity.sysSlug': true},
        function(err, record) {
          if(err) {
            return callback(err);
          }
          if(record) {
            // simulate duplicate identity error
            err = new Error('Duplicate Identity.');
            err.name = 'MongoError';
            err.code = 11000;
            return callback(err);
          }
          callback();
        });
    },
    setDefaults: ['checkDuplicate', function(callback) {
      var defaults = bedrock.util.clone(bedrock.config.identity.defaults);

      // add identity defaults
      identity = bedrock.util.extend(
        {}, defaults.identity, bedrock.util.clone(identity));

      // create identity ID from slug if not present
      if(!('id' in identity)) {
        identity.id = api.createIdentityId(identity.sysSlug);
      }

      // generate resource role resources
      var roles = identity.sysResourceRole = identity.sysResourceRole || [];
      for(var i = 0; i < roles.length; ++i) {
        var role = roles[i];
        if(role.generateResource === 'id') {
          role.resource = [identity.id];
          delete role.generateResource;
        } else if(role.generateResource) {
          // unknown
          return callback(new BedrockError(
            'Could not create Identity; unknown ResourceRole rule.',
            'InvalidResourceRole', {sysResourceRole: role}));
        }
      }

      /* Note: If the identity doesn't have a password, generate a fake one
      for them (that will not be known by anyone). This simplifies the code
      path for verifying passwords. */
      if(!('sysPassword' in identity)) {
        identity.sysPassword = _generatePasscode();
      }

      callback();
    }],
    generatePasscode: ['checkDuplicate', function(callback) {
      // generate new random passcode for identity
      callback(null, _generatePasscode());
    }],
    hashPassword: ['checkDuplicate', function(callback) {
      if(identity.sysHashedPassword === true) {
        // password already hashed
        delete identity.sysHashedPassword;
        return callback(null, identity.sysPassword);
      }
      api.createPasswordHash(identity.sysPassword, callback);
    }],
    hashPasscode: ['generatePasscode', function(callback, results) {
      if(identity.sysHashedPasscode === true) {
        // passcode already hashed
        delete identity.sysHashedPasscode;
        return callback(null, identity.sysPasscode);
      }
      api.createPasswordHash(results.generatePasscode, callback);
    }],
    insert: ['hashPassword', 'hashPasscode', function(callback, results) {
      // store hash results
      identity.sysPassword = results.hashPassword;
      identity.sysPasscode = results.hashPasscode;

      logger.info('creating identity', identity);

      // insert the identity
      var now = Date.now();
      var record = {
        id: database.hash(identity.id),
        meta: {
          created: now,
          updated: now
        },
        identity: identity
      };
      database.collections.identity.insert(
        record, database.writeOptions, function(err, result) {
          if(err) {
            return callback(err);
          }
          // return unhashed passcode in record
          result.ops[0].identity.sysPasscode = results.generatePasscode;
          callback(null, result.ops[0]);
        });
    }]
  }, function(err, results) {
    callback(err, results.insert);
  });
}

/**
 * A helper function for verifying passwords and passcodes.
 *
 * @param identity the Identity with the password or passcode.
 * @param type 'password' or 'passcode'.
 * @param callback(err, verified) called once the operation completes.
 */
function _verifyIdentityPasswordHash(identity, type, callback) {
  var field = 'sys' + type[0].toUpperCase() + type.substr(1);
  async.waterfall([
    function(callback) {
      // get status and <type> from db
      var fields = {'identity.sysStatus': true};
      fields['identity.' + field] = true;
      database.collections.identity.findOne(
        {id: database.hash(identity.id)}, fields, callback);
    },
    function(record, callback) {
      if(!record) {
        return callback(new BedrockError(
          'Could not verify Identity ' + type + '. Identity not found.',
          'NotFound'));
      }
      if(record.identity.sysStatus !== 'active') {
        return callback(new BedrockError(
          'Could not verify Identity ' + type + '. Identity is not active.',
          'IdentityInactive'));
      }
      callback(null, record.identity[field]);
    },
    function(hash, callback) {
      api.verifyPasswordHash(hash, identity[field], callback);
    },
    function(verified, legacy) {
      if(!verified || !legacy) {
        return callback(null, verified);
      }

      // update legacy password
      api.createPasswordHash(identity[field], function(err, hash) {
        var update = {$set: {}};
        update.$set['identity.' + field] = hash;
        database.collections.identity.update(
          {id: database.hash(identity.id)}, update,
          database.writeOptions,
          function(err) {
            callback(err, verified);
          });
      });
      callback(null, verified);
    }
  ], callback);
}

// static passcode character set
var CHARSET = (
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');

/**
 * Generates a passcode for resetting a password. This passcode must be
 * stored using a password hash in the database.
 *
 * @return the generated passcode.
 */
function _generatePasscode() {
  // passcodes are 8 chars long
  var rval = '';
  for(var i = 0; i < 8; ++i) {
    rval += CHARSET.charAt(parseInt(Math.random() * (CHARSET.length - 1), 10));
  }
  return rval;
}

/**
 * Adds a public key to an identity, inserting it into the database.
 *
 * @param publicKey the PublicKey to insert.
 * @param privateKey optional private key.
 * @param callback(err, record) called once the operation completes.
 */
function _addIdentityPublicKey(publicKey, privateKey, callback) {
  logger.debug('adding public key', publicKey);
  if(typeof privateKey === 'function') {
    callback = privateKey;
    privateKey = null;
  }
  async.waterfall([
    function(callback) {
      // load and verify keypair
      var keypair = {
        publicKey: ursa.createPublicKey(publicKey.publicKeyPem, 'utf8'),
        privateKey: (privateKey ?
          ursa.createPrivateKey(privateKey.privateKeyPem, 'utf8') : null)
      };
      if(keypair.publicKey === null) {
        return callback(new BedrockError(
          'Could not add public key to Identity. Invalid public key.',
          'InvalidPublicKey'));
      }
      if(privateKey && keypair.privateKey === null) {
        return callback(new BedrockError(
          'Could not add private key to Identity. Invalid private key.',
          'InvalidPrivateKey'));
      }
      if(privateKey) {
        var ciphertext = keypair.publicKey.encrypt('plaintext', 'utf8');
        var plaintext = keypair.privateKey.decrypt(ciphertext, null, 'utf8');
        if(plaintext !== 'plaintext') {
          return callback(new BedrockError(
            'Could not add public key to Identity. Key pair does not match.',
            'InvalidKeyPair'));
        }
      }
      callback();
    },
    function(callback) {
      // id provided, skip public key ID generation
      if('id' in publicKey) {
        return callback(null, null);
      }

      // get next public key ID from identity meta
      // FIXME: ensure query contains shard key for findAndModify
      database.collections.identity.findAndModify(
        {id: database.hash(publicKey.owner)},
        [['id', 'asc']],
        {$inc: {'meta.lastPublicKeyId': 1}},
        bedrock.util.extend(
          {}, database.writeOptions,
          {upsert: true, 'new': true, fields: {'meta.lastPublicKeyId': true}}),
        function(err, result) {
          callback(err, err ? null : result.value);
        });
    },
    function(record, callback) {
      // set default status
      if(!('sysStatus' in publicKey)) {
        publicKey.sysStatus = 'active';
      }

      // if no ID was provided, get last public key ID and update it
      if(!('id' in publicKey)) {
        publicKey.id = api.createIdentityPublicKeyId(
          publicKey.owner, record.meta.lastPublicKeyId);

        // if no label was provided, add default label
        if(!('label' in publicKey)) {
          publicKey.label = util.format(
            'Key %d', record.meta.lastPublicKeyId);
        }
      }

      // if no type given add it
      if(!('type' in publicKey)) {
        publicKey.type = 'CryptographicKey';
      }

      // add private key if given
      if(privateKey) {
        publicKey = bedrock.util.clone(publicKey);
        privateKey = bedrock.util.clone(privateKey);
        publicKey.privateKey = privateKey;
        privateKey.type = privateKey.type || publicKey.type;
        privateKey.label = privateKey.label || publicKey.label;
        privateKey.publicKey = publicKey.id;
      }

      // insert the publc key
      var now = Date.now();
      var record = {
        id: database.hash(publicKey.id),
        owner: database.hash(publicKey.owner),
        pem: database.hash(publicKey.publicKeyPem),
        meta: {
          created: now,
          updated: now
        },
        publicKey: publicKey
      };
      database.collections.publicKey.insert(
        record, database.writeOptions, function(err, result) {
          if(err) {
            return callback(err);
          }
          callback(null, result.ops[0]);
        });
    }
  ], callback);
}
