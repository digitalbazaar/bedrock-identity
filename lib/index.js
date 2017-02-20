/*
 * Bedrock Identity module.
 *
 * Copyright (c) 2012-2017 Digital Bazaar, Inc. All rights reserved.
 */
var _ = require('lodash');
var async = require('async');
var bedrock = require('bedrock');
var config = bedrock.config;
var brPermission = require('bedrock-permission');
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
      }, {
        collection: 'identity',
        fields: {owner: 1, id: 1},
        options: {sparse: true, unique: true, background: false}
      }, {
        collection: 'identity',
        fields: {memberOf: 1, id: 1},
        options: {sparse: true, unique: true, background: false}
      }], callback);
    }]
  }, function(err) {
    callback(err);
  });
});

bedrock.events.on(
  'bedrock-identity.delegateCapability.translate', (event, callback) => {
    const resource = event.capability.resource;
    if(typeof resource !== 'string') {
      // already translated, ignore
      return callback();
    }

    // look up identity owner and add to the resource list for the capability
    const query = {
      id: database.hash(resource),
      'identity.sysStatus': 'active'
    };
    database.collections.identity.findOne(query, {
      'identity.owner': 1
    }, (err, record) => {
      if(!err && record && record.identity && record.identity.owner) {
        // add owner to resource list to permit delegation
        event.capability.resource = [resource, record.identity.owner];
        return callback(err, record.identity.owner);
      }
      // error or nothing found to translate
      callback(err);
    });
  });

/**
 * Check for the existence of an identity.
 *
 * @param actor the Identity performing the action.
 * @param id the ID of the identity to check.
 * @param [options] the options to use.
            [deleted] true to check identities marked as deleted.
 * @param callback(err, exists) called once the operation completes.
 */
api.exists = function(actor, id, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  async.auto({
    get: callback => {
      const query = {
        id: database.hash(id),
        'identity.sysStatus': options.deleted ? 'deleted' : 'active'
      };
      database.collections.identity.findOne(query, {
        'identity.id': 1,
        'identity.owner': 1
      }, (err, record) => callback(err, record ? record.identity : null));
    },
    checkPermission: ['get', (callback, results) => {
      const resources = [id];
      if(results.get && results.get.owner) {
        resources.push(results.get.owner);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS, {resource: resources}, callback);
    }]
  }, (err, results) => callback(err, !!results.get));
};

/**
 * Inserts a specified ID into a role's resource restriction array. The given
 * role is copied and the given ID is inserted into the new role's resource
 * restriction array.
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
      const resources = [identity];
      if(identity.owner) {
        resources.push(identity.owner);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_INSERT, {resource: resources}, callback);
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
    generateResource: ['emitInsert', function(callback) {
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
      callback();
    }],
    checkMemberOf: ['generateResource', function(callback) {
      if(identity.memberOf) {
        return _ensureMembershipValid(actor, identity, callback);
      }
      callback();
    }],
    checkSysResourceRole: ['generateResource', function(callback) {
      if(identity.sysResourceRole) {
        return _ensureSysResourceRoleValid(
          actor, identity, {owner: identity.owner}, callback);
      }
      callback();
    }],
    insert: ['checkMemberOf', 'checkSysResourceRole', function(callback) {
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
  async.auto({
    get: callback => database.collections.identity.findOne(
      {id: database.hash(id)}, {}, callback),
    checkPermission: ['get', (callback, results) => {
      const resources = [id];
      if(results.get && results.get.identity.owner) {
        resources.push(results.get.identity.owner);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ACCESS, {resource: resources}, callback);
    }],
    exists: ['checkPermission', (callback, results) => {
      if(!results.get) {
        return callback(new BedrockError(
          'Identity not found.',
          'NotFound',
          {id: id, httpStatusCode: 404, public: true}));
      }
      callback();
    }],
    transform: ['exists', (callback, results) => {
      const identity = _transformRoles(results.get.identity);
      callback(null, {identity: identity, meta: results.get.meta});
    }]
  }, (err, results) => callback(
    err,
    results.transform ? results.transform.identity : null,
    results.transform ? results.transform.meta : null));
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
      // TODO: move permission check to after query to allow users with
      //       non-admin permissions to use this function.
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
 * Note: Use of this function without specifying `options.changes` is
 * deprecated. Always pass a `changes` option to update an identity.
 *
 * @param actor the Identity performing the action.
 * @param identity the Identity to update or the Identity's ID if using
 *          `options.changes`.
 * @param [options] the options to use.
 *          [filter(field)] a custom filter function for selecting which
 *            fields will be included in the update.
 *          [changes] an array of operations to make to update the identity,
 *            e.g.: [{op: 'set', value: {name: 'foo'}].
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
  if('changes' in options) {
    if(!Array.isArray(options.changes)) {
      if(options.changes && typeof options.changes !== 'object') {
        throw new TypeError('options.changes must be an object or an array.');
      }
      options.changes = [options.changes];
    }
    if(typeof identity !== 'string') {
      throw new TypeError(
        'When using `options.changes`, `identity` must be a string.');
    }

    return _updateIdentity(actor, identity, options, callback);
  }
  if(typeof identity !== 'object') {
    throw new TypeError(
      'When not specifying `options.changes`, `identity` must be an object.');
  }

  _deprecatedUpdateIdentity(actor, identity, options, callback);
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
  async.auto({
    checkAdminPermission: function(callback) {
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_ADMIN, {resource: identity}, function(err) {
          if(err) {
            return callback(null, false);
          }
          callback(null, true);
      });
    },
    checkSysResourceRole: ['checkAdminPermission', function(callback, results) {
      if(!results.checkAdminPermission && identity.sysResourceRole) {
        return _ensureSysResourceRoleValid(actor, identity, callback);
      }
      callback();
    }],
    updateDatabase: ['checkSysResourceRole', function(callback, results) {
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
    }]
  }, callback);
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

function _updateIdentity(actor, identityId, options, callback) {
  async.auto({
    get: callback => {
      const query = {
        id: database.hash(identityId),
        'identity.sysStatus': options.deleted ? 'deleted' : 'active'
      };
      database.collections.identity.findOne(query, {
        'identity.id': 1,
        'identity.owner': 1
      }, (err, record) => {
        if(err) {
          return callback(err);
        }
        if(!record) {
          return callback(new BedrockError(
            'Could not update Identity. Identity not found.',
            'NotFound', {httpStatusCode: 400, public: true}));
        }
        callback(null, record.identity);
      });
    },
    checkChanges: ['get', (callback, results) => {
      _checkChanges(actor, results.get, options.changes, callback);
    }],
    update: ['checkChanges', (callback, results) => {
      // build set/push/pull fields from operations in changes
      const identity = {};
      const pushFields = {};
      for(const change of options.changes) {
        if(change.op === 'set') {
          bedrock.util.extend(identity, change.value);
          continue;
        }
        if(change.op === 'add') {
          for(const key in change.value) {
            const field = `identity.${key}`;
            if(field in pushFields) {
              pushFields[field].$each.push(...change.value[key]);
            } else {
              pushFields[field] = {$each: [...change.value[key]]};
            }
          }
          continue;
        }
        // TODO: implement `remove` w/`pullFields`
      }

      // build set fields from the configured list of accepted fields
      const permittedFields = config.identity.fields;
      const setFields = database.buildUpdate(identity, 'identity', {
        include: permittedFields
      });

      const update = {};
      if(Object.keys(setFields).length > 0) {
        update.$set = setFields;
      }
      if(Object.keys(pushFields).length > 0) {
        update.$addToSet = pushFields;
      }
      if(Object.keys(update).length === 0) {
        return callback(new BedrockError(
          'Could not update Identity. No valid fields specified in change set.',
          'InvalidOperation', {httpStatusCode: 400}));
      }
      database.collections.identity.update(
        {id: database.hash(results.get.id)}, update,
        database.writeOptions, callback);
    }],
    checkUpdate: ['update', (callback, results) => {
      if(results.update.result.n === 0) {
        return callback(new BedrockError(
          'Could not update Identity. Identity not found.',
          'NotFound', {httpStatusCode: 404, public: true}));
      }
      callback();
    }]
  }, err => callback(err));
}

function _checkChanges(actor, identity, changes, callback) {
  const cache = {};
  async.eachSeries(changes, (change, callback) => {
    if(!change.value || typeof change.value !== 'object') {
      return callback(new BedrockError(
        `Could not update Identity. Change operation "${change.op}" has no ` +
        'valid "value" field.', 'InvalidOperation',
        {operation: change, httpStatusCode: 400}));
    }
    if(change.op === 'set') {
      const resources = [identity.id];
      if('owner' in identity) {
        resources.push(identity.owner);
      }
      return api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: resources}, callback);
    }
    if(change.op === 'add') {
      // TODO: _ensureSysResourceRoleValid will internally produce a list
      // of capabilities that gets checked; each check will emit an event
      // to allow modules to "translate" the resource ID list for each
      // capability; as there may be duplicate capabilities, we could optimize
      // those events (emit fewer with the same result) by moving the event
      // emission here after we produce all capabilities we are delegating
      // instead of calling it internally
      return async.each(Object.keys(change.value), key => {
        if(key === 'sysResourceRole') {
          return _ensureSysResourceRoleValid(
            actor, change.value, {cache: cache}, callback);
        }
        if(key === 'memberOf') {
          return _ensureMembershipValid(actor, change.value, callback);
        }
        /*
        // TODO: check a list of valid fields for adding -- and if valid,
        // do a simple IDENTITY_EDIT permission check for non-special fields?
        // TODO: optimize to call only once
        api.checkPermission(
          actor, PERMISSIONS.IDENTITY_EDIT, {resource: identity.id},
          callback);*/
        callback(new BedrockError(
          'Could not update Identity. Invalid field in "add" change operation.',
          'InvalidOperation', {operation: change, httpStatusCode: 400}));
      }, err => callback(err));
    }
    // TODO: implement `remove`
    return callback(new BedrockError(
      `Could not update Identity. Invalid change operation "${change.op}".`,
      'InvalidOperation', {operation: change, httpStatusCode: 400}));
  }, err => callback(err));
}

function _deprecatedUpdateIdentity(actor, identity, options, callback) {
  async.auto({
    get: callback => {
      const query = {
        id: database.hash(identity.id),
        'identity.sysStatus': options.deleted ? 'deleted' : 'active'
      };
      database.collections.identity.findOne(query, {
        'identity.id': 1,
        'identity.owner': 1
      }, (err, record) => callback(err, record ? record.identity : null));
    },
    checkPermission: ['get', (callback, results) => {
      const resources = [identity.id];
      if(results.get && results.get.owner) {
        resources.push(results.get.owner);
      }
      api.checkPermission(
        actor, PERMISSIONS.IDENTITY_EDIT, {resource: resources}, callback);
    }],
    checkMemberOf: ['checkPermission', (callback, results) => {
      if(identity.memberOf) {
        return _ensureMembershipValid(actor, identity, callback);
      }
      callback();
    }],
    update: ['checkMemberOf', callback => {
      // build a database update from the configured list of accepted fields
      var permittedFields = config.identity.fields;
      var update = database.buildUpdate(identity, 'identity', {
        include: permittedFields
      });
      if(Object.keys(update).length === 0) {
        return callback(new BedrockError(
          'Could not update Identity. No valid fields specified in change set.',
          'InvalidOperation', {httpStatusCode: 400}));
      }
      database.collections.identity.update(
        {id: database.hash(identity.id)},
        {$set: update}, database.writeOptions, callback);
    }],
    checkUpdate: ['update', (callback, results) => {
      if(results.update.result.n === 0) {
        return callback(new BedrockError(
          'Could not update Identity. Identity not found.',
          'NotFound', {httpStatusCode: 404, public: true}));
      }
      callback();
    }]
  }, err => callback(err));
}

function _ensureMembershipValid(actor, identity, callback) {
  identity.memberOf = _cleanMemberOf(identity);
  var groups = identity.memberOf;
  async.each(groups, (group, callback) => {
    async.auto({
      get: callback => {
        const query = {
          id: database.hash(group),
          'identity.type': 'Group',
          'identity.sysStatus': 'active'
        };
        database.collections.identity.findOne(query, {
          'identity.id': 1,
          'identity.owner': 1
        }, (err, record) => callback(err, record ? record.identity : null));
      },
      checkPermission: ['get', (callback, results) => {
        if(!results.get) {
          return callback(new BedrockError(
            'Cannot become a member of a Group that does not exist.',
            'InvalidResource', {identity: identity, group: group}));
        }
        api.checkPermission(
          actor, PERMISSIONS.IDENTITY_UPDATE_MEMBERSHIP,
          {resource: results.get, translate: 'owner'}, callback);
      }]
    }, (err, results) => callback(err, !!results.get));
  }, err => callback(err));
}

function _cleanMemberOf(identity) {
  // ensure groups are an array and all items in array are unique
  var groups = bedrock.util.clone(identity.memberOf);
  if(!Array.isArray(identity.memberOf)) {
    groups = [identity.memberOf];
  }
  groups = _.uniq(groups);

  return groups;
}

function _ensureSysResourceRoleValid(actor, identity, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = bedrock.util.extend({cache: {}}, options);
  if(!Array.isArray(identity.sysResourceRole)) {
    identity.sysResourceRole = [identity.sysResourceRole];
  }
  if(actor === null) {
    // optimization to skip all permission checks; `actor` of null has
    // full administrative permission
    return callback();
  }
  async.auto({
    cacheRoles: callback => {
      if(options.cache.roles) {
        return callback(null, options.cache.roles);
      }
      brPermission.getRoles(null, (err, roles) => {
        if(err) {
          return callback(err);
        }
        options.cache.roles = {};
        roles
          .filter(role => role.sysStatus !== 'deleted')
          .forEach(role => options.cache.roles[role.id] = role);
        callback(null, options.cache.roles);
      });
    },
    buildCapabilities: ['cacheRoles', (callback, results) => {
      // produce the list of capabilities that are to be delegated and
      // ensure the actor can delegate each one
      const capabilities = [];
      for(const capabilitySet of identity.sysResourceRole) {
        const roleId = capabilitySet.sysRole;
        let resources = capabilitySet.resource;
        capabilitySet.delegator = actor ? actor.id : null;

        // ensure role is valid
        if(!(roleId in results.cacheRoles)) {
          return callback(new BedrockError(
            'Could not check permissions; provided role is invalid.',
            'InvalidResource', {sysRole: roleId}));
        }
        const role = results.cacheRoles[roleId];

        // ensure resources are an array
        if(typeof resources === 'string') {
          resources = capabilitySet.resource = [resources];
        } else if(!Array.isArray(resources)) {
          resources = [null];
        }

        // build list of capabilities to check
        for(const permission of role.sysPermission) {
          for(const resource of resources) {
            const capability = {permission: permission};
            if(options.owner) {
              // if resource owner was given (i.e. for inserting a new
              // identity), then do immediate translation here
              capability.resource = [resource, options.owner];
            } else {
              capability.resource = resource;
            }
            capabilities.push(capability);
          }
        }
      }

      // make capabilities unique to reduce unnecessary duplicate checks
      callback(null, _.uniqWith(capabilities, _.isEqual));
    }],
    emitTranslate: ['buildCapabilities', (callback, results) => async.each(
      results.buildCapabilities, (capability, callback) => {
        if(capability.resource === null) {
          // no resource to translate
          return callback();
        }
        const event = {
          actor: actor,
          capability: capability
        };
        // emit an event that allows listeners to translate the resource ID in
        // the capability to another resource ID or a list of resource IDs
        // to be checked for `IDENTITY_DELEGATE_CAPABILITY` permission instead
        // of (just) the original resource ID... this allows modules to
        // indicate that, for example, that if the actor is the 'owner' of a
        // particular resource, they may delegate capabilities with it even if
        // they do not directly have the capability for the resource itself
        bedrock.events.emit(
          'bedrock-identity.delegateCapability.translate', event, callback);
      }, err => callback(err))],
    checkCapabilityDelegation: ['emitTranslate', (callback, results) => {
      // ensure the actor can delegate for each capability in the set
      _checkDelegateCapability(actor, results.buildCapabilities, callback);
    }]
  }, err => callback(err));
}

function _checkDelegateCapability(actor, capabilities, callback) {
  // ensure actor has permission for the resource
  async.each(capabilities, (capability, callback) =>
    async.auto({
      hasOwnCapability: callback => api.checkPermission(
        actor, capability.permission,
        capability.resource ? {resource: capability.resource} : {},
        callback),
      canDelegate: callback => api.checkPermission(
        actor, PERMISSIONS.IDENTITY_DELEGATE_CAPABILITY,
        capability.resource ? {resource: capability.resource} : {},
        callback)
    }, err => callback(err)),
    err => callback(err));
}

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
