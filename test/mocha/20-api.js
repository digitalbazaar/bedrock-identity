/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* globals should */
'use strict';

const _ = require('lodash');
const async = require('async');
const brIdentity = require('bedrock-identity');
const expect = global.chai.expect;
const helpers = require('./helpers');
const mockData = require('./mock.data');

let actors = {};

describe('bedrock-identity part 2', function() {
  before(function(done) {
    async.auto({
      prepare: function(callback) {
        helpers.prepareDatabase(mockData, callback);
      },
      getActors: ['prepare', function(callback) {
        helpers.getActors(mockData, function(err, result) {
          actors = result;
          callback(err);
        });
      }]
    }, done);
  });
  describe.only('updateRole API', function() {
    describe('null actor', function() {
    }); // end null actor
    describe('regular user', function() {
      it('should update the resource on a role', done => {
        const roleId = 'bedrock-identity.regular';
        async.auto({
          update: callback => brIdentity.updateRole(
            actors['organization-owner'], {
              role: roleId,
              identityId: actors['organization-owner'].id,
              resourceId: actors.organization.id,
              operation: 'add'
            }, (err, result) => {
              expect(err).not.to.be.ok;
              expect(result).not.to.be.ok;
              callback();
            }),
          test: ['update', callback => brIdentity.get(
            null, actors['organization-owner'].id, (err, result) => {
              expect(err).to.not.be.ok;
              const role = _.find(result.sysResourceRole, {sysRole: roleId});
              testRole(role, roleId, [
                actors.organization.id, actors['organization-owner'].id]);
              callback();
            })]
        }, done);
      });
    });
    describe('admin user', function() {
    });
  });

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
