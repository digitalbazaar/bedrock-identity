/*
 * Bedrock Identity module.
 *
 * Copyright (c) 2012-2015 Digital Bazaar, Inc. All rights reserved.
 */
var async = require('async');
var bedrock = require('bedrock');
var bedrockPermission = require('bedrock-permission');
var database = require('bedrock-mongodb');
var ursa = require('ursa');
var util = require('util');
var BedrockError = bedrock.util.BedrockError;

// load config defaults
require('./config');

// module permissions
var PERMISSIONS = bedrock.config.permission.permissions;

// module API
var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock-mongodb.ready', function init(callback) {
  async.auto({
    openCollections: function(callback) {
      database.openCollections(['identity', 'publicKey'], callback);
    },
    createIndexes: ['openCollections', function(callback) {
      database.createIndexes([{
        collection: 'identity',
        fields: {id: 1},
        options: {unique: true, background: false}
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
    }]
  }, function(err) {
    callback(err);
  });
});

/**
 * Inserts a new Identity. The Identity must contain `id`.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity containing at least the minimum required data.
 * @param callback(err, record) called once the operation completes.
 */
api.insert = function(actor, identity, callback) {
  async.auto({
    checkPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_INSERT, {resource: identity}, callback);
    },
    insert: ['checkPermission', function(callback) {
      identity = bedrock.util.clone(identity);

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

      logger.info('inserting identity', identity);

      // insert the identity
      var now = Date.now();
      var record = {
        id: database.hash(identity.id),
        meta: {created: now, updated: now},
        identity: identity
      };
      database.collections.identity.insert(
        record, database.writeOptions, function(err, result) {
          if(err) {
            return callback(err);
          }
          callback(null, result.ops[0]);
        });
    }]
  }, function(err, results) {
    callback(err, results.insert);
  });
};

/**
 * Retrieves an Identity.
 *
 * @param actor the Identity performing the action.
 * @param id the ID of the Identity to retrieve.
 * @param callback(err, identity, meta) called once the operation completes.
 */
api.get = function(actor, id, callback) {
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
          {id: id, httpStatusCode: 404, public: true}));
      }
      callback(null, record.identity, record.meta);
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
api.getAll = function(actor, query, fields, options, callback) {
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
 * Sets an Identity's status.
 *
 * @param actor the Identity performing the action.
 * @param id the Identity ID.
 * @param status the status.
 * @param callback(err) called once the operation completes.
 */
api.setStatus = function(actor, id, status, callback) {
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
          'NotFound',
          {httpStatusCode: 404, key: publicKey, public: true}
        ));
      }
      callback();
    }
  ], callback);
};

/**
 * Sets the Identity's ResourceRoles from the identity['sysResourceRole'] array.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity that is being updated.
 * @param callback(err) called once the operation completes.
 */
api.setRoles = function(actor, identity, callback) {
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
 * This method is a passthrough to the permission module's `checkPermission`
 * call, but, if necessary, it can look up an actor's `sysResourceRole` using
 * its `id`, prior to calling it.
 *
 * @param actor the Identity that wants to act, if null is given, permission
 *          will be granted.
 * @param permission the permission to check.
 * @param options the options to use, see: bedrock-permission.checkPermission.
 * @param callback(err, [identifiers]) called once the operation completes.
 */
api.checkPermission = function(actor, permission, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  // if actor can be passed immediately, do so
  if(typeof actor === 'undefined' || actor === null ||
    actor.sysResourceRole || actor.sysPermissionTable) {
    return bedrockPermission.checkPermission(
      actor, permission, options, callback);
  }

  // get actor's roles and then check permission
  database.collections.identity.findOne(
    {id: database.hash(actor.id)}, {'identity.sysResourceRole': true},
    function(err, result) {
      if(err) {
        return callback(err);
      }
      if(!result) {
        actor.sysResourceRole = [];
      } else {
        actor.sysResourceRole = result.identity.sysResourceRole;
      }
      bedrockPermission.checkPermission(actor, permission, options, callback);
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
api.createPublicKeyId = function(ownerId, name) {
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
api.addPublicKey = function(actor, publicKey, privateKey, callback) {
  if(typeof privateKey === 'function') {
    callback = privateKey;
    privateKey = null;
  }
  async.auto({
    parse: function(callback) {
      // load and verify keypair
      var keypair = {};
      try {
        keypair.publicKey =
          ursa.createPublicKey(publicKey.publicKeyPem, 'utf8');
      } catch(ex) {
        return callback(new BedrockError(
          'Could not add public key to Identity. Invalid public key.',
          'InvalidPublicKey', {
            cause: ex,
            httpStatusCode: 400,
            'public': true
          }));
      }
      try {
        keypair.privateKey =
          (privateKey ?
           ursa.createPrivateKey(privateKey.privateKeyPem, 'utf8') :
           null);
      } catch(ex) {
        return callback(new BedrockError(
          'Could not add private key to Identity. Invalid private key.',
          'InvalidPrivateKey', {
            cause: ex,
            httpStatusCode: 400,
            'public': true
          }));
      }
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
    checkPermission: ['parse', function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.PUBLIC_KEY_CREATE,
        {resource: publicKey, translate: 'owner'}, callback);
    }],
    generateId: ['checkPermission', function(callback) {
      // id provided, skip public key ID generation
      if('id' in publicKey) {
        return callback(null, null);
      }

      // get next public key ID from identity meta
      // TODO: ensure query contains shard key for findAndModify
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
    }],
    insert: ['generateId', function(callback, results) {
      // set default status
      if(!('sysStatus' in publicKey)) {
        publicKey.sysStatus = 'active';
      }

      // if no ID was provided, get last public key ID and update it
      if(!('id' in publicKey)) {
        publicKey.id = api.createPublicKeyId(
          publicKey.owner, results.generateId.meta.lastPublicKeyId);

        // if no label was provided, add default label
        if(!('label' in publicKey)) {
          publicKey.label = util.format(
            'Key %d', results.generateId.meta.lastPublicKeyId);
        }
      }

      // if no type given add it
      if(!('type' in publicKey)) {
        publicKey.type = 'CryptographicKey';
      }

      // log prior to adding private key
      logger.debug('adding public key', publicKey);

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
    }]
  }, function(err, results) {
    callback(err, results.insert);
  });
};

/**
 * Retrieves an Identity's PublicKey.
 *
 * @param publicKey the PublicKey with 'id' or both 'owner' and
 *          'publicKeyPem' set.
 * @param actor the Identity performing the action (if given, an
 *          access check will be performed, which is useful to run when
 *          using any associated private key).
 * @param callback(err, publicKey, meta, privateKey) called once the
 *          operation completes.
 */
api.getPublicKey = function(publicKey, actor, callback) {
  if(typeof actor === 'function') {
    callback = actor;
    actor = null;
  }
  actor = actor || null;
  async.auto({
    find: function(callback) {
      var query = {};
      if('id' in publicKey) {
        query.id = database.hash(publicKey.id);
      } else {
        query.owner = database.hash(publicKey.owner);
        query.pem = database.hash(publicKey.publicKeyPem);
      }
      database.collections.publicKey.findOne(query, {}, callback);
    },
    checkPermission: ['find', function(callback, results) {
      var record = results.find;
      // no such public key
      if(!record) {
        return callback(new BedrockError(
          'PublicKey not found.',
          'NotFound',
          {httpStatusCode: 404, key: publicKey, public: true}
        ));
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS,
        {resource: publicKey, translate: 'owner'},
        callback);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    var record = results.find;
    var privateKey = record.publicKey.privateKey || null;
    delete record.publicKey.privateKey;
    callback(null, record.publicKey, record.meta, privateKey);
  });
};

/**
 * Retrieves an Identity's PublicKey(s).
 *
 * @param id the ID of the identity to get the PublicKeys for.
 * @param actor the Identity performing the action (if `undefined`, private
 *          keys will be removed from the results).
 * @param callback(err, records) called once the operation completes.
 */
api.getPublicKeys = function(id, actor, callback) {
  if(typeof actor === 'function') {
    callback = actor;
    actor = undefined;
  }
  async.auto({
    find: function(callback) {
      database.collections.publicKey.find(
        {owner: database.hash(id)}, {}).toArray(callback);
    },
    checkPermission: ['find', function(callback) {
      if(actor === undefined) {
        return callback();
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS,
        {resource: id}, function(err) {
          callback(err);
        });
    }],
    clean: ['checkPermission', function(callback, results) {
      var records = results.find;
      // remove private keys if no actor was provided
      if(actor === undefined) {
        records.forEach(function(record) {
          delete record.publicKey.privateKey;
        });
      }
      callback(null, records);
    }]
  }, function(err, results) {
    callback(err, results.clean);
  });
};

/**
 * Updates descriptive data for a PublicKey.
 *
 * @param actor the Identity performing the action.
 * @param publicKey the publicKey to update.
 * @param callback(err) called once the operation completes.
 */
api.updatePublicKey = function(actor, publicKey, callback) {
  async.auto({
    checkPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {
          resource: publicKey,
          translate: 'owner',
          get: _getPublicKeyForPermissionCheck
        }, callback);
    },
    update: ['checkPermission', function(callback) {
      // exclude restricted fields
      database.collections.publicKey.update(
        {id: database.hash(publicKey.id)},
        {$set: database.buildUpdate(
          publicKey, 'publicKey', {exclude: [
            'publicKey.sysStatus', 'publicKey.publicKeyPem',
            'publicKey.owner']})},
        database.writeOptions,
        callback);
    }],
    checkUpdate: ['update', function(callback, results) {
      if(results.update.result.n === 0) {
        return callback(new BedrockError(
          'Could not update public key. Public key not found.',
          'NotFound',
          {httpStatusCode: 404, key: publicKey, public: true}
        ));
      }
      callback();
    }]
  }, callback);
};

/**
 * Revokes a PublicKey.
 *
 * @param actor the Identity performing the action.
 * @param publicKeyId the ID of the publicKey to revoke.
 * @param callback(err, key) called once the operation completes.
 */
api.revokePublicKey = function(actor, publicKeyId, callback) {
  async.auto({
    getPublicKey: function(callback) {
      api.getPublicKey(
        {id: publicKeyId}, function(err, publicKey, meta, privateKey) {
        if(privateKey) {
          publicKey.privateKey = privateKey;
        }
        callback(err, publicKey);
      });
    },
    checkPermission: ['getPublicKey', function(callback, results) {
      api.checkPermission(
        actor, PERMISSIONS.PUBLIC_KEY_REMOVE,
        {resource: results.getPublicKey, translate: 'owner'}, function(err) {
          callback(err, results.getPublicKey);
        });
    }],
    update: ['checkPermission', function(callback, results) {
      var publicKey = results.getPublicKey;
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
          callback(err, result);
        });
    }],
    checkUpdate: ['update', function(callback, results) {
      if(results.update.result.n === 0) {
        return callback(new BedrockError(
          'Could not revoke public key. Public key not found or already ' +
          'revoked.',
          'NotFound',
          {httpStatusCode: 404, key: publicKey, public: true}
        ));
      }
      callback();
    }]
  }, function(err, results) {
    callback(err, results.getPublicKey);
  });
};

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
  api.get(null, identity, function(err, identity) {
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
  api.getPublicKey(null, publicKey, function(err, publicKey) {
    callback(err, publicKey);
  });
}
