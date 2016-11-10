/*
 * Bedrock Identity module.
 *
 * Copyright (c) 2012-2016 Digital Bazaar, Inc. All rights reserved.
 */
var async = require('async');
var bedrock = require('bedrock');
var config = bedrock.config;
var brPermission = require('bedrock-permission');
var config = bedrock.config;
var database = require('bedrock-mongodb');
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
 * Check for the existence of an identity.
 *
 * @param actor the Identity performing the action.
 * @param id the ID of the identity to check.
 * @param callback(err, exists) called once the operation completes.
 */
api.exists = function(actor, id, callback) {
  async.auto({
    checkPermission: callback => {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS, {resource: id}, callback);
    },
    checkExists: ['checkPermission', callback => {
      database.collections.identity.find({
        id: database.hash(id)
      }, {
        limit: 1
      }).count((err, count)=> {
        callback(err, !!count);
      });
    }]
  }, (err, results) => {
    callback(err, results.checkExists);
  });
};

/**
 * Inserts a specified ID into a role's resource restriction array.
 *
 * @param role the role to transform.
 * @param id the ID to insert into the resource array.
 *
 * @return role the transformed role.
 */
api.generateResource = function(role, id) {
  role = bedrock.util.clone(role);
  if(!role.resource) {
    role.resource = [id];
  } else if(role.resource.indexOf(id) === -1) {
    role.resource.push(id);
  }
  delete role.generateResource;
  return role;
};

/**
 * Inserts a new Identity. The Identity must contain `id`.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity containing at least the minimum required data.
 * @param callback(err, record) called once the operation completes.
 */
api.insert = function(actor, identity, callback) {
  var meta = {};
  var eventData;
  async.auto({
    checkPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_INSERT, {resource: identity}, callback);
    },
    emitInsert: ['checkPermission', function(callback) {
      identity = bedrock.util.clone(identity);
      eventData = {
        actor: actor,
        identity: identity,
        meta: meta,
        // data to pass to `postInsert`, but do not insert into database
        postInsert: {
          /* <module-name>: <module-specific data> */
        }
      };
      bedrock.events.emit('bedrock-identity.insert', eventData, callback);
    }],
    insert: ['emitInsert', function(callback) {
      // generate resource role resources
      var roles = identity.sysResourceRole = identity.sysResourceRole || [];
      for(var i = 0; i < roles.length; ++i) {
        var role = roles[i];
        if(role.generateResource === 'id') {
          roles[i] = api.generateResource(role, identity.id);
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
    }],
    emitPostInsert: ['insert', function(callback, results) {
      var record = results.insert;
      eventData.identity = bedrock.util.clone(record.identity);
      eventData.meta = bedrock.util.clone(record.meta);
      bedrock.events.emit(
        'bedrock-identity.postInsert', eventData, callback);
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
    },
    function(identity, meta, callback) {
      identity = _transformRoles(identity);
      callback(null, identity, meta);
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
      api.checkPermission(actor, PERMISSIONS.IDENTITY_ACCESS, callback);
    },
    function(callback) {
      database.collections.identity.find(
        query, fields, options).toArray(callback);
    },
    function(result, callback) {
      result.forEach(function(i) {
        if(i.identity) {
          i.identity = _transformRoles(i.identity);
        }
      });
      callback(null, result);
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
      // Build a database update from the configured list of accepted fields.
      var permittedFields = config.identity.fields;
      var update = database.buildUpdate(identity, 'identity', {
        include: permittedFields
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
      // generate resource role resources
      var roles = identity.sysResourceRole = identity.sysResourceRole || [];
      for(var i = 0; i < roles.length; ++i) {
        var role = roles[i];
        if(role.generateResource === 'id') {
          // Append identity.id to the given resource list,
          // if it doesn't already exist
          if(!role.resource) {
            role.resource = [identity.id];
          } else if(role.resource.indexOf(identity.id) === -1) {
            role.resource.push(identity.id);
          }
          delete role.generateResource;
        } else if(role.generateResource) {
          // unknown
          return callback(new BedrockError(
            'Could not set roles.',
            'InvalidResourceRole', {sysResourceRole: role}));
        }
      }
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
 * **Deprecated - use bedrock-permission's `.checkPermission`** instead.
 * Modules that want to check permissions should not have to rely upon
 * the use of this module solely for that reason. In order to use
 * bedrock-permission's version of this call, modules must ensure that
 * `sysResourceRole` is set in `actor`. All that this deprecated call does
 * is set that value on the actor before passing it to bedrock-permission
 * instead, that value is usually automatically set by other parts in the
 * authN infrastructure of an application, such as bedrock-passport for
 * authenticating users who make HTTP-based calls.
 *
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
        result.identity = _transformRoles(result.identity);
        actor.sysResourceRole = result.identity.sysResourceRole;
      }
      brPermission.checkPermission(actor, permission, options, callback);
    });
};

/**
 * Transforms the roles in an identity to URLs as needed.
 *
 * @param identity the identity to operate on.
 *
 * @return identity the transformed identity.
 */
function _transformRoles(identity) {
  if(config.permission.roleBaseUrl.length !== 0 && identity.sysResourceRole) {
    identity.sysResourceRole.forEach(function(role) {
      if(role.sysRole.indexOf(':') !== -1) {
        return;
      }
      role.sysRole = config.permission.roleBaseUrl + '/' +
        encodeURIComponent(role.sysRole);
    });
  }
  return identity;
}
