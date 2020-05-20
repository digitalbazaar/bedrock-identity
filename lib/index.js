/*
 * Copyright (c) 2012-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const _ = require('lodash');
const {promisify} = require('util');
const assert = require('assert-plus');
const bedrock = require('bedrock');
const {callbackify: brCallbackify} = bedrock.util;
const brPermission = require('bedrock-permission');
const brPermissionCheck = promisify(brPermission.checkPermission);
const getRoles = promisify(brPermission.getRoles);
const database = require('bedrock-mongodb');
const identitySchema = require('../schemas/bedrock-identity')();
const jsonpatch = require('fast-json-patch');
const {validateInstance} = require('bedrock-validation');
const {BedrockError} = bedrock.util;

// load config defaults
require('./config');

// module permissions
const PERMISSIONS = bedrock.config.permission.permissions;

// module API
const api = {};
module.exports = api;

const logger = bedrock.loggers.get('app').child('bedrock-identity');

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await promisify(database.openCollections)(['identity']);

  await promisify(database.createIndexes)([{
    collection: 'identity',
    fields: {id: 1},
    options: {unique: true, background: false}
  }, {
    // `id` is a prefix to allow for sharding on `id` -- a collection
    // cannot be sharded unless its unique indexes have the shard key
    // as a prefix; a separate non-unique index is used for lookups
    collection: 'identity',
    fields: {id: 1, owner: 1},
    options: {
      partialFilterExpression: {owner: {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    // cover common queries
    collection: 'identity',
    fields: {id: 1, 'meta.status': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'identity',
    fields: {owner: 1},
    options: {
      partialFilterExpression: {owner: {$exists: true}},
      unique: false,
      background: false
    }
  }, {
    collection: 'identity',
    fields: {memberOf: 1},
    options: {
      partialFilterExpression: {memberOf: {$exists: true}},
      unique: false,
      background: false
    }
  }]);
});

bedrock.events.on(
  'bedrock-identity.delegateCapability.translate', async event => {
    const {originalResource, newResources} = event;

    // normalize original resources
    const originalResources = !Array.isArray(originalResource) ?
      [originalResource] : originalResource;

    // find all owners of resources
    const owners = [];
    const cache = {};
    for(const r of originalResources) {
      const id = (typeof r === 'string') ? r : r.id;
      let owner;
      if(id in newResources) {
        owner = newResources[id].owner;
      } else if(id in cache) {
        owner = cache[id];
      } else {
        // TODO: can we check `id` namespace to prevent unnecessary lookups?

        // look up identity owner
        const query = {
          id: database.hash(id),
          'meta.status': 'active'
        };
        const record = await database.collections.identity.findOne(
          query, {_id: 0, 'identity.owner': 1});
        if(record && record.identity && record.identity.owner) {
          cache[id] = owner = record.identity.owner;
        } else {
          cache[id] = false;
        }
      }
      if(typeof owner === 'string') {
        owners.push(owner);
      }
    }

    // add owners to list of resources to permit delegation via ownership
    event.capability.resource.push(...owners);
    event.capability.resource = _.uniq(event.capability.resource);
  });

/**
 * Inserts a new Identity. The Identity must contain `id`.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param identity the Identity containing at least the minimum required data.
 * @param [meta] optional meta information to include.
 *
 * @return a Promise that resolves to the new record.
 */
api.insert = brCallbackify(async ({actor, identity, meta}) => {
  assert.object(identity, 'identity');
  assert.string(identity.id, 'identity.id');
  assert.optionalString(identity.owner, 'identity.owner');

  meta = Object.assign({}, meta, {status: 'active'});
  // ensure resource roles are an array
  if(meta.sysResourceRole && !Array.isArray(meta.sysResourceRole)) {
    meta.sysResourceRole = [meta.sysResourceRole];
  }

  const resource = [identity];
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_INSERT,
    resource,
    translate: 'owner'
  });

  identity = bedrock.util.clone(identity);

  const eventData = {
    actor,
    identity,
    meta,
    // data to pass to `postInsert`, but do not insert into database
    postInsert: {
      /* <module-name>: <module-specific data> */
    }
  };
  await bedrock.events.emit('bedrock-identity.insert', eventData);

  // replay assertions post event emission
  assert.object(identity, 'identity');
  assert.string(identity.id, 'identity.id');
  assert.optionalString(identity.owner, 'identity.owner');
  assert.string(meta.status, 'meta.status');

  // generate resource role resources
  const roles = meta.sysResourceRole = meta.sysResourceRole || [];
  for(let i = 0; i < roles.length; ++i) {
    const role = roles[i];
    if(role.generateResource === 'id') {
      roles[i] = api.generateResource({role, id: identity.id});
    } else if(role.generateResource) {
      // unknown generation directive
      throw new BedrockError(
        'Could not create Identity; unknown ResourceRole rule.',
        'NotSupportedError', {sysResourceRole: role});
    }
  }

  // ensure membership is valid
  if(identity.memberOf) {
    await _ensureMembershipValid({actor, identity});
  }

  // validate resource roles (ensure actor is permitted to delegate the
  // roles specified in the meta)
  if(meta.sysResourceRole.length > 0) {
    await api.validateCapabilityDelegation({
      actor,
      resourceRoles: meta.sysResourceRole,
      newResources: {[identity.id]: identity}
    });
  }

  logger.info('inserting identity', identity);

  // insert the identity and get updated record
  const now = Date.now();
  meta.created = now;
  meta.updated = now;
  meta.sequence = 0;
  let record = {
    id: database.hash(identity.id),
    meta,
    identity
  };
  try {
    const result = await database.collections.identity.insertOne(
      record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate identity.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }

  // emit `postInsert` event with updated record data
  eventData.identity = bedrock.util.clone(record.identity);
  eventData.meta = bedrock.util.clone(record.meta);
  await bedrock.events.emit('bedrock-identity.postInsert', eventData);

  return record;
});

/**
 * Check for the existence of an identity.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param id the ID of the identity to check.
 * @param [status] the status to check for (default: 'active', options:
 *          'active', deleted').
 *
 * @return a Promise that resolves to a boolean.
 */
api.exists = brCallbackify(async ({actor, id, status = 'active'}) => {
  assert.string(id, 'id');
  assert.string(status, 'status');

  const query = {
    id: database.hash(id),
    'meta.status': status
  };
  const {identity = null} = await database.collections.identity.findOne(query, {
    _id: 0,
    'identity.id': 1,
    'identity.owner': 1
  }) || {};

  const resource = [id];
  if(identity && identity.owner) {
    resource.push(identity.owner);
  }
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_ACCESS,
    resource
  });

  return !!identity;
});

/**
 * Retrieves an Identity.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param id the ID of the Identity to retrieve.
 *
 * @param a Promise that resolves to `{identity, meta}`.
 */
api.get = brCallbackify(async ({actor, id}) => {
  const record = await database.collections.identity.findOne(
    {id: database.hash(id)}, {_id: 0, identity: 1, meta: 1});

  // allow identity `owner` access
  const resource = [id];
  if(record && record.identity && record.identity.owner) {
    resource.push(record.identity.owner);
  }
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_ACCESS,
    resource,
    translate: 'owner'
  });

  if(!record) {
    throw new BedrockError(
      'Identity not found.',
      'NotFoundError',
      {identity: id, httpStatusCode: 404, public: true});
  }

  brPermission.expandRoles(record.meta.sysResourceRole);

  return record;
});

/**
 * Retrieves all Identities matching the given query.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param [query] the optional query to use (default: {}).
 * @param [fields] optional fields to include or exclude (default: {}).
 * @param [options] options (eg: 'sort', 'limit').
 *
 * @param a Promise that resolves to the records that matched the query.
 */
api.getAll = brCallbackify(async (
  {actor, query = {}, fields = {}, options = {}}) => {
  // TODO: move permission check to after query to allow users with
  // more granular permissions to use this function
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_ACCESS
  });
  // FIXME remove options.fields from all libraries that call on this method
  // instead use options.projection
  if(fields) {
    logger.info('The parameter fields in method getAll is being ' +
      'deprecated please use options.projection instead');
  }
  options.projection = options.projection || fields;
  const records = await database.collections.identity.find(query, options).toArray();
  for(const record of records) {
    if(record.meta) {
      brPermission.expandRoles(record.meta.sysResourceRole);
    }
  }

  return records;
});

/**
 * Updates an Identity.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param id the ID of the identity to update.
 * @param patch a JSON patch for performing the update.
 * @param sequence the sequence number that must match the current record,
 *          prior to the patch.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.update = brCallbackify(async ({actor, id, patch, sequence}) => {
  assert.string(id, 'id');
  assert.array(patch, 'patch');
  assert.number(sequence, 'sequence');

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  const record = await api.get({actor, id});
  if(record.meta.sequence !== sequence) {
    return new BedrockError(
      'Could not update Identity. Record sequence does not match.',
      'InvalidStateError', {
        httpStatusCode: 409,
        public: true,
        actual: sequence,
        expected: record.meta.sequence
      });
  }

  const resource = [record.identity];
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_UPDATE,
    resource,
    translate: 'owner'
  });

  const errors = jsonpatch.validate(patch, record.identity);
  if(errors) {
    throw new BedrockError(
      'The given JSON patch is invalid.', 'ValidationError', {
        httpStatusCode: 400,
        public: true,
        patch,
        errors
      });
  }

  // apply patch and validate result
  const patched = jsonpatch.applyPatch(record.identity, patch).newDocument;
  const validateResult = validateInstance(patched, identitySchema);
  if(!validateResult.valid) {
    throw validateResult.error;
  }
  if(patched.memberOf) {
    await _ensureMembershipValid({actor, identity: patched});
  }

  const result = await database.collections.identity.updateOne({
    id: database.hash(id),
    'meta.sequence': sequence
  }, {
    $set: {identity: patched},
    $inc: {'meta.sequence': 1}
  }, database.writeOptions);

  if(result.result.n === 0) {
    return new BedrockError(
      'Could not update Identity. Record sequence does not match.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }
});

/**
 * Sets an Identity's status.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param id the Identity ID.
 * @param status the status.
 *
 * @param a Promise that resolves once the operation completes.
 */
api.setStatus = brCallbackify(async ({actor, id, status}) => {
  assert.string(id, 'id');
  assert.string(status, 'status');

  const record = await api.get({actor, id});

  const resource = [record.identity];
  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_META_UPDATE,
    resource,
    translate: 'owner'
  });

  const result = await database.collections.identity.updateOne(
    {id: database.hash(id)}, {
      $set: {'meta.status': status},
      $inc: {'meta.sequence': 1}
    }, database.writeOptions);

  if(result.result.n === 0) {
    throw new BedrockError(
      'Could not set Identity status. Identity not found.',
      'NotFoundError',
      {httpStatusCode: 404, identity: id, public: true});
  }
});

/**
 * Sets the Identity's ResourceRoles from the given resource roles arrays.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param id the ID of the Identity that is to be updated.
 * @param [add] the resourceRoles to add.
 * @param [remove] the resourceRoles to remove.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.updateRoles = brCallbackify(async (
  {actor, id, add = [], remove = [], sequence}) => {
  assert.string(id, 'id');
  assert.array(add, 'add');
  assert.array(remove, 'remove');
  assert.number(sequence);

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  // get identity record and check its sequence number
  const {identity, meta} = await api.get({actor: null, id});
  if(meta.sequence !== sequence) {
    return new BedrockError(
      'Could not update Identity. Record sequence does not match.',
      'InvalidStateError', {
        httpStatusCode: 409,
        public: true,
        actual: sequence,
        expected: meta.sequence
      });
  }

  // if actor has meta update capability for the identity there's no need
  // to check for capability delegation
  // Note: **WARNING** this implementation means that any actor with the
  // ability to authenticate as the identity to which they can bestow any
  // capability is essentially an admin
  let isAdmin = false;
  try {
    await _checkPermission({
      actor,
      permission: PERMISSIONS.IDENTITY_META_UPDATE,
      resource: [identity],
      translate: 'owner'
    });
    isAdmin = true;
  } catch(e) {}

  // generate resource role resources
  add = bedrock.util.clone(add);
  remove = bedrock.util.clone(remove);
  const changes = add.concat(remove);
  for(const role of changes) {
    if(role.generateResource === 'id') {
      // append identity `id` to the given resource list,
      // if it doesn't already exist
      if(!role.resource) {
        role.resource = [id];
      } else if(role.resource.indexOf(id) === -1) {
        role.resource.push(id);
      }
      delete role.generateResource;
    } else if(role.generateResource) {
      // unknown resource generation rule
      throw new BedrockError(
        'Could not set roles; unknown ResourceRole rule.',
        'NotSupportedError', {sysResourceRole: role});
    }
  }

  if(!isAdmin && add.length > 0) {
    // if any roles are being added, ensure whatever capabilities that arise
    // from the resource roles in `add` can be delegated
    await api.validateCapabilityDelegation({actor, resourceRoles: add});
  }

  if(!isAdmin && remove.length > 0) {
    // if any roles are being removed, ensure actor has the capability to
    // do so...
    let canRemove = false;

    // blanket permission to remove things from the given identity
    try {
      await _checkPermission({
        actor,
        permission: PERMISSIONS.IDENTITY_REMOVE,
        resource: [identity],
        translate: 'owner'
      });
      canRemove = true;
    } catch(e) {}

    if(!canRemove) {
      /* Note: In order for a resource role to be removed from an identity,
        the `actor` must have a special revocation capability to do so. This
        capability must have the permission `IDENTITY_CAPABILITY_REVOKE` a
        resource list that matches *every* resource listed in the resource
        role that is to be removed. To be clear, an actor with a revocation
        capability that has a resource for the identity the resource roles
        are being removed from does not mean it can remove ANY capability
        from that identity. It means it can remove any capability from that
        identity that refers to *THAT IDENTITY*. For example, an attempt to
        remove a capability that the identity had for another resource would
        trigger a `NotAllowedError` error here less the actor had a revoke
        capability with that other resource's ID in its resource list. This
        is somewhat counterintuitive given the way other capabilities work,
        but it was a compromise to enable revocation of capabilities in
        the system without having to do a larger rewrite of the entire
        permission system. Eventually a rewrite should be performed to
        make reasoning about capabilities in the system more clear. */

      // check each removal for specific revocation capability for resource
      for(const role of remove) {
        // TODO: optimize with permission `and` params or something?
        const resources = role.resource ? role.resource : [undefined];
        for(const resource of resources) {
          await _checkPermission({
            actor,
            permission: PERMISSIONS.IDENTITY_CAPABILITY_REVOKE,
            resource
          });
        }
      }
    }
  }

  // 1. remove specified resource roles
  // 2. add specified resource roles
  // 3. ensure resource roles are unique
  const resourceRoles = _.uniqWith(
    brPermission.mergeCapabilities(
      brPermission.subtractCapabilities(meta.sysResourceRole, remove),
      add),
    _.isEqual);

  await database.collections.identity.updateOne(
    {id: database.hash(id)}, {
      $set: {'meta.sysResourceRole': resourceRoles},
      $inc: {'meta.sequence': 1}
    }, database.writeOptions);
});

/**
 * Gets the capabilities for a given identity.
 *
 * @param id the ID of the identity to get the capabilities for.
 *
 * @return a Promise that resolves to an `actor` once the operation completes.
 */
api.getCapabilities = brCallbackify(async ({id}) => {
  assert.string(id, 'id');

  const record = await database.collections.identity.findOne(
    {id: database.hash(id)}, {_id: 0, 'meta.sysResourceRole': 1});
  const resourceRoles = record ? record.meta.sysResourceRole : [];

  const actor = {
    // TODO: deprecate use of `id` here?
    id,
    sysResourceRole: brPermission.expandRoles(resourceRoles)
  };

  return actor;
});

/**
 * Validates whether the given actor has the permission to delegate the
 * given roles.
 *
 * @param actor the actor or capabilities required to perform the action.
 * @param resourceRoles the capabilities represented as resource roles.
 * @param newResources an optional map of resource ID => resource for
 *          resources that are in the process of being created; this allows
 *          for custom delegation checks against data before it enters a
 *          database.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.validateCapabilityDelegation = brCallbackify(async (
  {actor, resourceRoles, newResources = {}}) => {
  if(actor === null) {
    // optimization to skip all permission checks; `actor` of null has
    // full administrative permission
    return;
  }

  const roles = await getRoles(null);
  const roleMap = {};
  for(const role of roles) {
    if(role.sysStatus !== 'deleted') {
      roleMap[role.id] = role;
    }
  }

  // produce the list of capabilities that are to be delegated and
  // ensure the actor can delegate each one
  const capabilities = [];
  for(const capabilitySet of resourceRoles) {
    const {sysRole: roleId} = capabilitySet;
    let {resource: resources} = capabilitySet;

    // ensure role is valid
    if(!(roleId in roleMap)) {
      throw new BedrockError(
        'The given role is not supported.',
        'NotSupportedError', {sysRole: roleId});
    }
    const role = roleMap[roleId];

    // ensure resources are an array
    if(typeof resources === 'string') {
      resources = capabilitySet.resource = [resources];
    } else if(!Array.isArray(resources)) {
      resources = [undefined];
    }

    // build list of capabilities to check
    for(const permission of role.sysPermission) {
      for(const resource of resources) {
        const capability = {permission, resource};
        capabilities.push(capability);
      }
    }
  }

  // make capabilities unique to reduce unnecessary duplicate checks
  _.uniqWith(capabilities, _.isEqual);

  // emit translation event to allow extensibility for every capability
  for(const capability of capabilities) {
    if(capability.resource === undefined) {
      // no resource to translate
      continue;
    }

    const originalResource = capability.resource;
    capability.resource = [capability.resource];
    const event = {
      actor,
      capability,
      originalResource,
      newResources
    };
    // emit an event that allows listeners to translate the resource ID in
    // the capability to another resource ID or a list of resource IDs
    // to be checked for `IDENTITY_CAPABILITY_DELEGATE` permission instead
    // of (just) the original resource ID... this allows modules to
    // indicate that, for example, that if the actor does not have the
    // `IDENTITY_CAPABILITY_DELEGATE` capability for a particular resource but
    // has it for the `owner` of said resource, they may delegate capabilities;
    // this enables certain capabilities to be transitive through ownership
    await bedrock.events.emit(
      'bedrock-identity.delegateCapability.translate', event);
  }

  // ensure the actor can delegate for each capability in the set
  return _checkDelegateCapabilities({actor, capabilities});
});

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
api.generateResource = ({role, id}) => {
  assert.string(id, 'id');
  assert.object(role, 'role');

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
 * Checks to see if an actor has been granted a permission to some resource.
 * This method is a passthrough to the permission module's `checkPermission`
 * call, but, if necessary, it can look up an actor's `sysResourceRole` using
 * its `id`, prior to calling it.
 *
 * This method should NOT be exposed publicly as that would encourage breakage
 * of the permission model and the potential for moving to an object capability
 * model in the future.
 *
 * @param actor the actor or capabilities for performing the action, if `null`
 *          is given, permission will be granted.
 * @param permission the permission to check.
 * @param [resource] an optional array of resources to check against the
 *          permission.
 * @param [translate] an optional translation function (or string identifying
 *          a built-in function) to translate resource IDs in some fashion
 *          prior to checking permissions.
 *
 * @return a Promise that resolves once the operation completes.
 */
async function _checkPermission({actor, permission, resource, translate}) {
  const options = {};
  if(resource) {
    options.resource = resource;
  }
  if(translate) {
    options.translate = translate;
  }

  // if actor can be passed immediately, do so
  if(typeof actor === 'undefined' || actor === null ||
    actor.sysResourceRole || actor.sysPermissionTable) {
    return brPermissionCheck(actor, permission, options);
  }

  // TODO: deprecate auto-retrieving capabilities, require devs to call
  // `getCapabilities` to create an `actor`

  // get actor's capabilities (via resource roles) if it has an `id` that is
  // an identity
  if(actor.id) {
    try {
      const newActor = api.getCapabilities({id: actor.id});
      actor.sysResourceRole = newActor.sysResoureRole;
    } catch(e) {}
  }

  return brPermissionCheck(actor, permission, options);
}

async function _ensureMembershipValid({actor, identity}) {
  const groups = identity.memberOf = _cleanMemberOf(identity);
  const hashes = groups.map(id => database.hash(id));
  const query = {
    id: {$in: hashes},
    'identity.type': 'Group',
    'meta.status': 'active'
  };
  const records = await database.collections.identity.find(query, {
    _id: 0,
    'identity.id': 1,
    'identity.owner': 1
  }).toArray();

  // ensure all groups exist
  const existing = records.map(r => r.identity.id);
  const notExisting = groups.filter(id => !existing.includes(id));
  if(notExisting.length > 0) {
    throw new BedrockError(
      'Cannot become a member of a Group that does not exist.',
      'NotAllowedError', {identity, group: notExisting});
  }

  // ensure actor may allow membership change for every group
  const groupIdentities = records.map(r => r.identity);
  for(const identity of groupIdentities) {
    await _checkPermission({
      actor,
      permission: PERMISSIONS.IDENTITY_UPDATE_MEMBERSHIP,
      resource: [identity],
      translate: 'owner'
    });
  }
}

function _cleanMemberOf(identity) {
  // ensure groups are an array and all items in array are unique
  let groups = bedrock.util.clone(identity.memberOf);
  if(!Array.isArray(identity.memberOf)) {
    groups = [identity.memberOf];
  }
  groups = _.uniq(groups);
  return groups;
}

async function _checkDelegateCapabilities({actor, capabilities}) {
  for(const capability of capabilities) {
    // ensure actor has capability itself for the resource
    await _checkPermission({
      actor,
      permission: capability.permission,
      resource: capability.resource
    });

    // ensure actor has delegation capability for the resource
    await _checkPermission({
      actor,
      permission: PERMISSIONS.IDENTITY_CAPABILITY_DELEGATE,
      resource: capability.resource
    });
  }
}
