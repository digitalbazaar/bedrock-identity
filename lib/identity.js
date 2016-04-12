/*
 * Bedrock Identity module.
 *
 * Copyright (c) 2012-2016 Digital Bazaar, Inc. All rights reserved.
 */
var async = require('async');
var bedrock = require('bedrock');
var brPermission = require('bedrock-permission');
var database = require('bedrock-mongodb');
var util = require('util');
var BedrockError = bedrock.util.BedrockError;

// load config defaults
require('./config');

bedrock.events.on('bedrock.test.configure', function() {
  require('./test.config');
});

// module permissions
var PERMISSIONS = bedrock.config.permission.permissions;

// module API
var api = {};
module.exports = api;

var logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock-mongodb.ready', function init(callback) {
  async.auto({
    openCollections: function(callback) {
      database.openCollections(['identity'], callback);
    },
    createIndexes: ['openCollections', function(callback) {
      database.createIndexes([{
        collection: 'identity',
        fields: {id: 1},
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
  var meta = {};
  async.auto({
    checkPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_INSERT, {resource: identity}, callback);
    },
    emit: ['checkPermission', function(callback) {
      bedrock.events.emit(
        'bedrock-identity.insert', {identity: identity, meta: meta}, callback);
    }],
    insert: ['emit', function(callback) {
      identity = bedrock.util.clone(identity);

      // remove plaintext sysPassword and sysPasscode
      delete identity.sysPassword;
      delete identity.sysPasscode;

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
      meta.created = now;
      meta.updated = now;
      var record = {
        id: database.hash(identity.id),
        meta: meta,
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
 * Updates an Identity. By default, restricted fields (any field starting with
 * `sys`) will not be updated in this call. To change this behavior a `filter`
 * function may be provided in the options.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity to update.
 * @param [options] the options to use.
 *          [filter(field)] a custom filter function for selecting which
 *            fields will be included in the update.
 * @param callback(err) called once the operation completes.
 */
api.update = function(actor, identity, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  // TODO: include identity translate functions that can be
  // called before updating an identity? ... or observers API?
  options = bedrock.util.extend({}, options);
  if(options.filter && typeof options.filter !== 'function') {
    throw new TypeError('options.filter must be a function.');
  }
  /* FIXME: remove filter support and/or improve with include/exclude
  if(!options.filter) {
    options.filter = function(field, obj) {
      return field.indexOf('sys') !== 0;
    };
  }
  */
  async.waterfall([
    function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: identity}, callback);
    },
    function(callback) {
      // build a database update
      var update = database.buildUpdate(identity, 'identity', {
        include: [
          'identity.description',
          'identity.image',
          'identity.label',
          'identity.sysGravatarType',
          'identity.sysImageType',
          'identity.sysPublic',
          'identity.sysResourceRole',
          'identity.sysSigningKey',
          'identity.url'
        ]
      });
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
api.setStatus = function(actor, identityId, status, callback) {
  async.waterfall([
    function(callback) {
      api.checkPermission(actor, PERMISSIONS.IDENTITY_ADMIN, callback);
    },
    function(callback) {
      database.collections.identity.update(
        {id: database.hash(identityId)},
        {$set: {'identity.sysStatus': status}},
        database.writeOptions,
        callback);
    },
    function(result, callback) {
      if(result.result.n === 0) {
        return callback(new BedrockError(
          'Could not set Identity status. Identity not found.',
          'NotFound',
          {httpStatusCode: 404, identityId: identityId, public: true}
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
        {$set: {'identity.sysResourceRole': identity.sysResourceRole}},
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
    return brPermission.checkPermission(
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
      brPermission.checkPermission(actor, permission, options, callback);
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
