/*
 * Copyright (c) 2015-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const brIdentity = require('bedrock-identity');
const database = require('bedrock-mongodb');
const helpers = require('./helpers');
const jsonpatch = require('fast-json-patch');
const mockData = require('./mock.data');
let actors;

describe('bedrock-identity', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
    actors = await helpers.getActors(mockData);
  });

  describe('setStatus API', () => {
    describe('null actor', async () => {
      it('should mark an identity deleted, then active', async () => {
        const testIdentity = actors['will-b-disabled'];
        await brIdentity.setStatus({
          actor: null,
          id: testIdentity.id,
          status: 'deleted'
        });

        // check status is deleted
        let record = await database.collections.identity.findOne({
          id: database.hash(testIdentity.id)
        });
        should.exist(record.identity);
        should.exist(record.meta);
        record.meta.status.should.equal('deleted');

        // reactivate identity
        await brIdentity.setStatus({
          actor: null,
          id: testIdentity.id,
          status: 'active'
        });

        // check status is active
        record = await database.collections.identity.findOne({
          id: database.hash(testIdentity.id)
        });
        should.exist(record.identity);
        should.exist(record.meta);
        record.meta.status.should.equal('active');
      });
      it('returns error on a non-existent identity', async () => {
        const id = 'https://example.com/i/nobody';
        let err;
        try {
          await brIdentity.setStatus({
            actor: null,
            id,
            status: 'deleted'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotFoundError');
        err.details.identity.should.equal(id);
      });
    }); // end null actor
    describe('regular user', () => {
      it('permission denied on attempt to change own status', async () => {
        const actor = actors.alpha;
        const testIdentity = actors.alpha;
        let err;
        try {
          await brIdentity.setStatus({
            actor,
            id: testIdentity.id,
            status: 'deleted'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
      });
      it('permission denied on attempt to change another identity\'s status',
        async () => {
          const actor = actors.alpha;
          const testIdentity = actors.admin;
          let err;
          try {
            await brIdentity.setStatus({
              actor,
              id: testIdentity.id,
              status: 'deleted'
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
        });
    });
    describe('admin user', function() {
      it('should mark an identity deleted, then active', async () => {
        const actor = actors.admin;
        const testIdentity = actors['will-b-disabled'];
        await brIdentity.setStatus({
          actor,
          id: testIdentity.id,
          status: 'deleted'
        });

        // check status is deleted
        let record = await database.collections.identity.findOne({
          id: database.hash(testIdentity.id)
        });
        should.exist(record.identity);
        should.exist(record.meta);
        record.meta.status.should.equal('deleted');

        // reactivate identity
        await brIdentity.setStatus({
          actor: null,
          id: testIdentity.id,
          status: 'active'
        });

        // check status is active
        record = await database.collections.identity.findOne({
          id: database.hash(testIdentity.id)
        });
        should.exist(record.identity);
        should.exist(record.meta);
        record.meta.status.should.equal('active');
      });
    });
  });

  describe('get API', () => {
    describe('null actor', () => {
      it('should return error on non-existent identity', async () => {
        let err;
        try {
          await brIdentity.get({
            actor: null,
            id: 'https://example.com/i/nobody'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotFoundError');
      });
      it('return identity when active option is not specified', async () => {
        const testIdentity = actors['will-b-disabled'];

        await brIdentity.setStatus({
          actor: null,
          id: testIdentity.id,
          status: 'deleted'
        });

        const record = await brIdentity.get({
          actor: null,
          id: testIdentity.id
        });
        should.exist(record);
        record.identity.should.be.an('object');
        record.meta.should.be.an('object');
        record.meta.status.should.equal('deleted');

        await brIdentity.setStatus({
          actor: null,
          id: testIdentity.id,
          status: 'active'
        });
      });
    }); // end null actor
    describe('regular user', () => {
      it('should be able to access itself', async () => {
        const actor = actors.alpha;
        const testIdentity = actors.alpha;
        const record = await brIdentity.get({
          actor,
          id: testIdentity.id
        });
        should.exist(record);
        record.identity.id.should.equal(testIdentity.id);
        record.meta.status.should.equal('active');
      });
      it('should not be able to access another identity', async () => {
        const actor = actors.alpha;
        const testIdentity = actors.admin;
        let err;
        let record;
        try {
          record = await brIdentity.get({
            actor,
            id: testIdentity.id
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(record);
        err.name.should.equal('PermissionDenied');
      });
    }); // end regular user
    describe('admin user', () => {
      it('should be able to access itself', async () => {
        const actor = actors.admin;
        const testIdentity = actors.admin;
        const record = await brIdentity.get({
          actor,
          id: testIdentity.id
        });
        should.exist(record);
        record.identity.id.should.equal(testIdentity.id);
        record.meta.status.should.equal('active');
      });
      it('should be able to access another identity', async () => {
        const actor = actors.admin;
        const testIdentity = actors.alpha;
        const record = await brIdentity.get({
          actor,
          id: testIdentity.id
        });
        should.exist(record);
        record.identity.id.should.equal(testIdentity.id);
      });
    }); // end admin user
  }); // end get API

  describe('insert API', () => {
    describe('null actor', () => {
      it('should insert an identity in the database', async () => {
        const userName = 'de3c2700-0c5d-4b75-bd6b-02dee985e39d';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({
          actor: null,
          identity: newIdentity
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        const {identity, meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
      });
      it('should return error when memberOf group does not exist', async () => {
        const userName = '7764af06-7fdf-4e5b-9866-94efea14d915';
        const groupName = '0bf1576c-9e67-4915-a133-622174ea9835';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newIdentity.memberOf = [newGroup.id];
        let err;
        try {
          await brIdentity.insert({
            actor: null,
            identity: newIdentity
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotAllowedError');
      });
      it('should return error on duplicate identity', async () => {
        const userName = '99748241-3599-41a0-8445-d092de558b9f';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({
          actor: null,
          identity: newIdentity
        });
        // attempt to insert the same identity again
        let err;
        try {
          await brIdentity.insert({
            actor: null,
            identity: newIdentity
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('DuplicateError');
        should.exist(err.cause);
        const {cause} = err;
        should.exist(cause.name);
        should.exist(cause.code);
        cause.code.should.equal(11000);
      });
      it('should properly generate a resource ID for one role', async () => {
        const userName = '15065125-6e65-4f2e-9736-bb49aee468a4';
        const newIdentity = helpers.createIdentity(userName);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        };
        await brIdentity.insert({
          actor: null,
          identity: newIdentity,
          meta: newMeta
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        const {identity, meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        // test sysResourceRole
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        testRole(
          meta.sysResourceRole[0], 'bedrock-identity.regular',
          ['https://example.com/i/' + userName]);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
      });
      it('returns error if generateResouce !== `id`', async () => {
        const userName = 'e29ea95f-fb91-4a03-8bdf-26d254caa953';
        const newIdentity = helpers.createIdentity(userName);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'notId'
          }]
        };
        let err;
        try {
          await brIdentity.insert({
            actor: null,
            identity: newIdentity,
            meta: newMeta
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotSupportedError');
        err.message.should.equal(
          'Could not create Identity; unknown ResourceRole rule.');
        err.details.should.be.an('object');
        err.details.sysResourceRole.should.be.an('object');
        err.details.sysResourceRole.sysRole
          .should.equal('bedrock-identity.regular');
        err.details.sysResourceRole.generateResource
          .should.equal('notId');
      });
      it('generates a resource ID for one role with other resources',
        async () => {
          const userName = '9d8a65ad-ab7c-407a-b818-e3a090680673';
          const altName = 'b7f24a46-9128-4aec-ab3d-1e9d7770f7da';
          const newIdentity = helpers.createIdentity(userName);
          const newMeta = {
            sysResourceRole: [{
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id',
              resource: ['https://example.com/i/' + altName]
            }]
          };
          await brIdentity.insert({
            actor: null,
            identity: newIdentity,
            meta: newMeta
          });
          const record = await database.collections.identity.findOne(
            {id: database.hash(newIdentity.id)});
          should.exist(record);
          const {identity, meta} = record;
          meta.should.be.an('object');
          should.exist(meta.created);
          meta.created.should.be.a('number');
          should.exist(meta.updated);
          meta.updated.should.be.a('number');
          meta.status.should.equal('active');
          // test sysResourceRole
          meta.sysResourceRole.should.be.an('array');
          meta.sysResourceRole.should.have.length(1);
          testRole(
            meta.sysResourceRole[0], 'bedrock-identity.regular', [
              'https://example.com/i/' + userName,
              'https://example.com/i/' + altName
            ]);
          identity.should.be.an('object');
          identity.id.should.equal('https://example.com/i/' + userName);
          identity.label.should.equal(userName);
          identity.email.should.equal(userName + '@bedrock.dev');
          identity.url.should.equal('https://example.com');
          identity.description.should.equal(userName);
        });
      it('should properly generate a resource ID for three roles', async () => {
        const userName = '6ed0734c-8a29-499f-8a21-eb3bd7923620';
        const newIdentity = helpers.createIdentity(userName);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.alpha',
            generateResource: 'id'
          }, {
            sysRole: 'bedrock-identity.beta',
            generateResource: 'id'
          }, {
            sysRole: 'bedrock-identity.gamma',
            generateResource: 'id'
          }]
        };
        await brIdentity.insert({
          actor: null,
          identity: newIdentity,
          meta: newMeta
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        const {identity, meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        // test sysResourceRole
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(3);
        testRole(
          meta.sysResourceRole[0], 'bedrock-identity.alpha',
          ['https://example.com/i/' + userName]);
        testRole(
          meta.sysResourceRole[1], 'bedrock-identity.beta',
          ['https://example.com/i/' + userName]);
        testRole(
          meta.sysResourceRole[2], 'bedrock-identity.gamma',
          ['https://example.com/i/' + userName]);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
      });
      it('should insert identity containing a group', async () => {
        const userName = '344cef84-5d1e-4972-9c4e-861c487a8498';
        const groupName = '8f46904d-3c18-468e-8843-0238e25b74dc';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Identity', 'Group'];
        newGroup.owner = newIdentity.id;
        newIdentity.memberOf = [newGroup.id];
        await brIdentity.insert({
          actor: null,
          identity: newGroup
        });
        await brIdentity.insert({
          actor: null,
          identity: newIdentity
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        should.exist(record.meta);
        should.exist(record.identity);
        const {identity} = record;
        identity.memberOf.should.have.same.members([newGroup.id]);
      });
      it('should allow identity w/ sysResourceRole of a group', async () => {
        const userName = '287f1746-1735-413c-9c53-6226f90c5112';
        const groupName = 'd2dc97b7-08e1-4e27-8cdc-08db71e304d0';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Identity', 'Group'];
        newGroup.owner = newIdentity.id;
        newIdentity.memberOf = [newGroup.id];
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            resource: newGroup.id
          }]
        };
        await brIdentity.insert({
          actor: null,
          identity: newGroup
        });
        await brIdentity.insert({
          actor: null,
          identity: newIdentity,
          meta: newMeta
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        should.exist(record.meta);
        should.exist(record.identity);
        const {identity} = record;
        identity.memberOf.should.have.same.members([newGroup.id]);
      });
    });
    describe('regular actor', () => {
      it('should insert an owned identity in the database', async () => {
        const actor = actors.alpha;
        const userName = '3e5e5bac-40f9-4c20-981e-375f4a5fe4e2';
        const newIdentity = helpers.createIdentity(userName);
        newIdentity.owner = actor.id;
        await brIdentity.insert({
          actor,
          identity: newIdentity
        });
        const record = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(record);
        const {identity, meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.owner.should.equal(actor.id);
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
      });
      it('should not insert an ownerless identity in the database',
        async () => {
          const actor = actors.alpha;
          const userName = '3940ce06-8f56-4196-972a-b8f574e8db0e';
          const newIdentity = helpers.createIdentity(userName);
          let err;
          try {
            await brIdentity.insert({
              actor,
              identity: newIdentity
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
          err.details.sysPermission.should.equal('IDENTITY_INSERT');
        });
      it('should return error when memberOf group does not exist', async () => {
        const actor = actors.alpha;
        const userName = '75ef5bdf-7863-41e4-bf3d-4f6ce6cab344';
        const groupName = 'e314422b-3001-45c0-88d1-406e40739196';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newIdentity.owner = actor.id;
        newIdentity.memberOf = [newGroup.id];
        let err;
        try {
          await brIdentity.insert({
            actor,
            identity: newIdentity
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotAllowedError');
      });
    });
  }); // end insert API

  describe('update API', () => {
    describe('null actor', () => {
      it('should update an identity in the database', async () => {
        const userName = '388f3331-1015-4b2b-9ed2-f931fe53d074';
        const newIdentity = helpers.createIdentity(userName);
        const newRecord = await brIdentity.insert({
          actor: null,
          identity: newIdentity
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.url = 'https://new.example.com';
        updatedIdentity.label = userName + 'UPDATED';
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        let error;
        try {
          await brIdentity.update({
            actor: null,
            id: updatedIdentity.id,
            patch,
            sequence: 0
          });
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        const updatedRecord = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(updatedRecord);
        const {identity, meta} = updatedRecord;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName + 'UPDATED');
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://new.example.com');
        identity.description.should.equal(userName);
      });
      it('should update identity to be in group', async () => {
        const userName = '2d0b166b-c428-421b-8ed5-ecf0d444cdc7';
        const groupName = 'cd2a84ff-04be-4efd-9b9b-14f4c920236e';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Group'];
        newGroup.owner = newIdentity.id;
        const newRecord = await brIdentity.insert({
          actor: null,
          identity: newIdentity
        });
        await brIdentity.insert({
          actor: null,
          identity: newGroup
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.memberOf = newGroup.id;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        await brIdentity.update({
          actor: null,
          id: updatedIdentity.id,
          patch,
          sequence: 0
        });
        const updatedRecord = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(updatedRecord);
        const {identity, meta} = updatedRecord;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
        identity.memberOf.should.have.same.members([newGroup.id]);
      });
      it('should update identity w/ sysResourceRole of a group', async () => {
        const userName = '814b3e02-db14-4fa2-b45b-5d8f977ac087';
        const groupName = '8314e48c-ff51-427e-aa7b-524cda45b708';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Identity', 'Group'];
        // TODO: this test is potentially odd because the identity is the
        // owner of the group and automatically inherits all its capabilities
        // without the additional resource role ... should, instead, it not be
        // the owner?
        newGroup.owner = newIdentity.id;
        newIdentity.memberOf = [newGroup.id];
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }, {
            sysRole: 'bedrock-identity.regular',
            resource: [newGroup.id]
          }]
        };
        await brIdentity.insert({
          actor: null,
          identity: newGroup
        });
        const newRecord = await brIdentity.insert({
          actor: null,
          identity: newIdentity,
          meta: newMeta
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.memberOf = newGroup.id;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        await brIdentity.update({
          actor: null,
          id: updatedIdentity.id,
          patch,
          sequence: 0
        });
        const updatedRecord = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(updatedRecord);
        const {identity, meta} = updatedRecord;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(2);
        meta.sysResourceRole.should.include.deep.members([{
          sysRole: 'bedrock-identity.regular',
          resource: [identity.id]
        }, {
          sysRole: 'bedrock-identity.regular',
          resource: [newGroup.id]
        }]);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
        identity.memberOf.should.have.same.members([newGroup.id]);
      });
    });
    describe('regular actor', () => {
      it('should update an identity in the database', async () => {
        const actor = actors.alpha;
        const userName = '6e1e026d-a679-4714-aecd-9f948a3d19e7';
        const newIdentity = helpers.createIdentity(userName);
        newIdentity.owner = actor.id;
        const newRecord = await brIdentity.insert({
          actor,
          identity: newIdentity
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.url = 'https://new.example.com';
        updatedIdentity.label = userName + 'UPDATED';
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        await brIdentity.update({
          actor,
          id: updatedIdentity.id,
          patch,
          sequence: 0
        });
        const updatedRecord = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(updatedRecord);
        const {identity, meta} = updatedRecord;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName + 'UPDATED');
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://new.example.com');
        identity.description.should.equal(userName);
      });
      it('should allow an identity to delegate capability to another one',
        async () => {
          const alpha = '9930e2f4-6b59-11e8-9457-9f540c45ea21';
          const beta = '995e0450-6b59-11e8-be3c-23b7c5cd73f9';
          const alphaIdentity = helpers.createIdentity(alpha);
          const betaIdentity = helpers.createIdentity(beta);

          await brIdentity.insert({
            actor: null,
            identity: alphaIdentity,
            meta: {
              // capability to do regular things with self
              sysResourceRole: {
                sysRole: 'bedrock-identity.regular',
                generateResource: 'id'
              }
            }
          });
          await brIdentity.insert({
            actor: null,
            identity: betaIdentity,
            meta: {
              // capability to do regular things with self
              sysResourceRole: {
                sysRole: 'bedrock-identity.regular',
                generateResource: 'id'
              }
            }
          });

          // now alpha grants capabilities to beta
          const actor = await brIdentity.getCapabilities(
            {id: alphaIdentity.id});
          await brIdentity.updateRoles({
            actor,
            id: betaIdentity.id,
            add: [{
              sysRole: 'bedrock-identity.regular',
              resource: [alphaIdentity.id]
            }],
            sequence: 0
          });

          const record = await database.collections.identity.findOne(
            {id: database.hash(betaIdentity.id)});
          should.exist(record);
          const {meta} = record;
          meta.should.be.an('object');
          should.exist(meta.created);
          meta.created.should.be.a('number');
          should.exist(meta.updated);
          meta.updated.should.be.a('number');
          meta.status.should.equal('active');
          meta.sysResourceRole.should.be.an('array');
          meta.sysResourceRole.should.have.length(1);
          meta.sysResourceRole.should.include.deep.members([{
            sysRole: 'bedrock-identity.regular',
            resource: [betaIdentity.id, alphaIdentity.id]
          }]);
        });
      it('should allow an identity to revoke delegated capability from ' +
        'another one', async () => {
        const alpha = 'c5bd7b3c-6b65-11e8-b2c1-0b9ed87d924b';
        const beta = 'c5efee14-6b65-11e8-ba3c-3ba368952b3e';
        const alphaIdentity = helpers.createIdentity(alpha);
        const betaIdentity = helpers.createIdentity(beta);

        await brIdentity.insert({
          actor: null,
          identity: alphaIdentity,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });
        await brIdentity.insert({
          actor: null,
          identity: betaIdentity,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });

        // now alpha grants capabilities to beta
        const actor = await brIdentity.getCapabilities({id: alphaIdentity.id});
        await brIdentity.updateRoles({
          actor,
          id: betaIdentity.id,
          add: [{
            sysRole: 'bedrock-identity.regular',
            resource: [alphaIdentity.id]
          }],
          sequence: 0
        });

        // now alpha revokes capabilities from beta
        await brIdentity.updateRoles({
          actor,
          id: betaIdentity.id,
          remove: [{
            sysRole: 'bedrock-identity.regular',
            resource: [alphaIdentity.id]
          }],
          sequence: 1
        });

        const record = await database.collections.identity.findOne(
          {id: database.hash(betaIdentity.id)});
        should.exist(record);
        const {meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        meta.sysResourceRole.should.include.deep.members([{
          sysRole: 'bedrock-identity.regular',
          resource: [betaIdentity.id]
        }]);
      });
      it('should deny an identity from delegating capability to another one',
        async () => {
          const alpha = 'dcb9b292-6b65-11e8-ae40-1ba368afe388';
          const beta = 'dcd6738c-6b65-11e8-a2c4-53c30c18ceba';
          const gamma = 'ec799ff8-6b65-11e8-9d93-2788f4e7b5c8';
          const alphaIdentity = helpers.createIdentity(alpha);
          const betaIdentity = helpers.createIdentity(beta);
          const gammaIdentity = helpers.createIdentity(gamma);

          await brIdentity.insert({
            actor: null,
            identity: alphaIdentity,
            meta: {
              // capability to do regular things with self
              sysResourceRole: {
                sysRole: 'bedrock-identity.regular',
                generateResource: 'id'
              }
            }
          });
          await brIdentity.insert({
            actor: null,
            identity: betaIdentity,
            meta: {
              // capability to do regular things with self
              sysResourceRole: {
                sysRole: 'bedrock-identity.regular',
                generateResource: 'id'
              }
            }
          });
          await brIdentity.insert({
            actor: null,
            identity: gammaIdentity,
            meta: {
              // capability to do regular things with self
              sysResourceRole: {
                sysRole: 'bedrock-identity.regular',
                generateResource: 'id'
              }
            }
          });

          // now alpha grants capabilities to beta
          const actor = await brIdentity.getCapabilities(
            {id: alphaIdentity.id});
          let err;
          try {
            await brIdentity.updateRoles({
              actor,
              id: betaIdentity.id,
              add: [{
                sysRole: 'bedrock-identity.regular',
                resource: [gammaIdentity.id]
              }],
              sequence: 0
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
        });
      it('should update identity to be in group', async () => {
        const userName = '5a9e4aa8-326e-41cb-94fa-70a65feb363f';
        const groupName = 'f033fe48-706b-4b04-95e2-d9dea9903768';
        const newIdentity = helpers.createIdentity(userName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Group'];
        newGroup.owner = newIdentity.id;
        const newRecord = await brIdentity.insert({
          actor: null,
          identity: newIdentity,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }]
          }
        });
        const newActor = await brIdentity.getCapabilities({id: newIdentity.id});
        await brIdentity.insert({
          actor: newActor,
          identity: newGroup,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }]
          }
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.memberOf = [newGroup.id];
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        await brIdentity.update({
          actor: newActor,
          id: updatedIdentity.id,
          patch,
          sequence: 0
        });
        const updatedRecord = await database.collections.identity.findOne(
          {id: database.hash(newIdentity.id)});
        should.exist(updatedRecord);
        const {identity, meta} = updatedRecord;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        identity.should.be.an('object');
        identity.id.should.equal('https://example.com/i/' + userName);
        identity.label.should.equal(userName);
        identity.email.should.equal(userName + '@bedrock.dev');
        identity.url.should.equal('https://example.com');
        identity.description.should.equal(userName);
        identity.memberOf.should.have.same.members([newGroup.id]);
      });
      it('should fail to add identity to a group because the actor used ' +
        'does not have the capability', async () => {
        const actor = actors.alpha;
        const userName = '49b3e2c4-64db-42a1-9c10-464c85e2f25d';
        const groupName = 'c85f98e9-cf58-483b-951f-58c341f4774d';
        const newIdentity = helpers.createIdentity(userName);
        // make actor the owner of the new identity
        newIdentity.owner = actor.id;
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Identity', 'Group'];
        newGroup.owner = newIdentity.id;
        const newGroupMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        };
        const newRecord = await brIdentity.insert({
          actor,
          identity: newIdentity,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }]
          }
        });
        const newActor = await brIdentity.getCapabilities({id: newIdentity.id});
        await brIdentity.insert({
          actor: newActor,
          identity: newGroup,
          meta: newGroupMeta
        });
        const updatedIdentity = newRecord.identity;
        const observer = jsonpatch.observe(updatedIdentity);
        updatedIdentity.memberOf = newGroup.id;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedIdentity, observer);
        // use original `regular` actor -- it should fail because actor is not
        // the owner of the group, despite being the owner of the identity that
        // owns the group (current permission model is not transparently
        // transitive... `regular` actor would have to first grant themselves
        // explicit capability to modify the group or its owner to be granted
        // permission here)
        let err;
        try {
          await brIdentity.update({
            actor,
            id: updatedIdentity.id,
            patch,
            sequence: 0
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
        err.details.should.be.an('object');
        err.details.sysPermission.should.equal(
          'IDENTITY_UPDATE_MEMBERSHIP');
      });
      it('should allow a group owner to grant capability to another identity ' +
        'to manage the group', async () => {
        // create an identity (memberName), a group owner identity (ownerName),
        // and a group (groupName) ... then have the group owner grant
        // permission to do anything with the group to the `memberName` identity
        const ownerName = 'fb37c8f9-20f7-4138-823e-f05d0d0e4272';
        const groupName = '7bbc9b88-0f9a-4af9-9f0e-3d55398cf58a';
        const memberName = 'ca544e5a-6b56-11e8-9a44-bb11fe890895';
        const newGroupOwner = helpers.createIdentity(ownerName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Group'];
        newGroup.owner = newGroupOwner.id;
        const newMember = helpers.createIdentity(memberName);
        newMember.memberOf = [newGroup.id];

        await brIdentity.insert({
          actor: null,
          identity: newGroupOwner,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });
        await brIdentity.insert({
          actor: null,
          identity: newGroup
          // no meta, group itself has no capabilities
        });
        await brIdentity.insert({
          actor: null,
          identity: newMember,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });

        // now group owner grants capabilities to group member
        const actor = await brIdentity.getCapabilities({id: newGroupOwner.id});
        await brIdentity.updateRoles({
          actor,
          id: newMember.id,
          add: [{
            sysRole: 'bedrock-identity.regular',
            resource: [newGroup.id]
          }],
          sequence: 0
        });

        const record = await database.collections.identity.findOne(
          {id: database.hash(newMember.id)});
        should.exist(record);
        const {meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        meta.sysResourceRole.should.include.deep.members([{
          sysRole: 'bedrock-identity.regular',
          resource: [newMember.id, newGroup.id]
        }]);
      });
      it('should prevent a non-group owner from granting capability to ' +
        'another identity to manage the group', async () => {
        // create an identity (memberName), a group owner identity (ownerName),
        // and a group (groupName) ... then have the group member try to give
        // itself permission to do anything with the group
        const ownerName = '03c57856-6b59-11e8-8e89-831da7f288a9';
        const groupName = '03ea4d3e-6b59-11e8-8781-67b6fc67dcb1';
        const memberName = '040a6f2e-6b59-11e8-b719-b743ca347ca2';
        const newGroupOwner = helpers.createIdentity(ownerName);
        const newGroup = helpers.createIdentity(groupName);
        newGroup.type = ['Group'];
        newGroup.owner = newGroupOwner.id;
        const newMember = helpers.createIdentity(memberName);
        newMember.memberOf = [newGroup.id];

        await brIdentity.insert({
          actor: null,
          identity: newGroupOwner,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });
        await brIdentity.insert({
          actor: null,
          identity: newGroup
          // no meta, group itself has no capabilities
        });
        await brIdentity.insert({
          actor: null,
          identity: newMember,
          meta: {
            // capability to do regular things with self
            sysResourceRole: {
              sysRole: 'bedrock-identity.regular',
              generateResource: 'id'
            }
          }
        });

        // now group member attempts to grant capabilities to self
        const actor = await brIdentity.getCapabilities({id: newMember.id});
        let err;
        try {
          await brIdentity.updateRoles({
            actor,
            id: newMember.id,
            add: [{
              sysRole: 'bedrock-identity.regular',
              resource: [newGroup.id]
            }],
            sequence: 0
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
      });
    });
  });

  describe('exists API', () => {
    describe('null actor', () => {
      it('returns false if identity does not exist', async () => {
        const actor = null;
        const id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        const exists = await brIdentity.exists({actor, id});
        exists.should.be.false;
      });
      it('returns true if identity exists', async () => {
        const actor = null;
        const userName = '9d8a34bb-6b3a-4b1a-b69c-322fbbd9536e';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({actor, identity: newIdentity});
        const exists = await brIdentity.exists({actor, id: newIdentity.id});
        exists.should.be.true;
      });
      it('returns false for deleted identity by default', async () => {
        const actor = null;
        const userName = '8a354515-17cb-453d-b45a-5d3964706f9f';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({actor, identity: newIdentity});
        await brIdentity.setStatus(
          {actor, id: newIdentity.id, status: 'deleted'});
        const exists = await brIdentity.exists({actor, id: newIdentity.id});
        exists.should.be.false;
      });
      it('returns true for deleted identity with deleted option', async () => {
        const actor = null;
        const userName = '76fbb25e-514d-4566-b270-b08ff8989543';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({actor, identity: newIdentity});
        await brIdentity.setStatus(
          {actor, id: newIdentity.id, status: 'deleted'});
        const exists = await brIdentity.exists(
          {actor, id: newIdentity.id, status: 'deleted'});
        exists.should.be.true;
      });
    }); // end null actor
    describe('regular user', () => {
      it('returns PermissionDenied when another user ID is specified',
        async () => {
          const actor = actors.alpha;
          const id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
          let err;
          try {
            await brIdentity.exists({actor, id});
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
          err.details.sysPermission.should.equal('IDENTITY_ACCESS');
        });
      it('returns true if own identity exists', async () => {
        const actor = actors.alpha;
        const exists = await brIdentity.exists({actor, id: actor.id});
        exists.should.be.true;
      });
    }); // end regular user
    describe('admin user', () => {
      it('returns false if identity does not exist', async () => {
        const actor = actors.admin;
        const id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        const exists = await brIdentity.exists({actor, id});
        exists.should.be.false;
      });
      it('returns true if identity exists', async () => {
        const actor = actors.admin;
        const userName = '474af20b-fdf8-472b-a22a-b510bebf452f';
        const newIdentity = helpers.createIdentity(userName);
        await brIdentity.insert({actor: null, identity: newIdentity});
        const exists = await brIdentity.exists({actor, id: newIdentity.id});
        exists.should.be.true;
      });
    }); // end admin user
  }); // end exists API
}); // end bedrock-identity

function testRole(role, roleId, resource) {
  role.should.be.an('object');
  should.not.exist(role.generateResource);
  should.exist(role.sysRole);
  role.sysRole.should.equal(roleId);
  should.exist(role.resource);
  role.resource.should.be.an('array');
  role.resource.should.have.same.members(resource);
}
