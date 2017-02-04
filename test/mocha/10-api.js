/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* globals should */
'use strict';

var async = require('async');
var brIdentity = require('bedrock-identity');
var database = require('bedrock-mongodb');
var helpers = require('./helpers');
var mockData = require('./mock.data');
var actors = {};

describe('bedrock-identity', function() {
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
  describe('setStatus API', function() {
    describe('null actor', function() {
      it('should mark an identity deleted, then active', function(done) {
        var testIdentity = actors['will-b-disabled'];
        async.auto({
          deleteIdentity: function(callback) {
            brIdentity.setStatus(null, testIdentity.id, 'deleted', callback);
          },
          checkStatusDeleted: ['deleteIdentity', function(callback) {
            database.collections.identity.findOne({
              id: database.hash(testIdentity.id)
            }, function(err, record) {
              should.not.exist(err);
              should.exist(record.identity);
              var i = record.identity;
              i.sysStatus.should.equal('deleted');
              callback();
            });
          }],
          activateIdentity: ['checkStatusDeleted', function(callback) {
            brIdentity.setStatus(null, testIdentity.id, 'active', callback);
          }],
          checkStatusActive: ['activateIdentity', function(callback) {
            database.collections.identity.findOne({
              id: database.hash(testIdentity.id)
            }, function(err, record) {
              should.not.exist(err);
              should.exist(record.identity);
              var i = record.identity;
              i.sysStatus.should.equal('active');
              callback();
            });
          }]
        }, done);
      });
      it('returns error on a non-existent identity', function(done) {
        var testIdentity = {id: 'https://example.com/i/nobody'};
        brIdentity.setStatus(null, testIdentity.id, 'deleted', function(err) {
          should.exist(err);
          err.name.should.equal('NotFound');
          err.details.identityId.should.equal(testIdentity.id);
          done();
        });
      });
    }); // end null actor
    describe('regular user', function() {
      it('permission denied on attempt to change own status', function(done) {
        var actor = actors.alpha;
        var testIdentity = actors.alpha;
        brIdentity
          .setStatus(actor, testIdentity.id, 'deleted', function(err) {
            should.exist(err);
            err.name.should.equal('PermissionDenied');
            err.details.sysPermission.should.equal('IDENTITY_ADMIN');
            done();
          });
      });
      it('permission denied on attempt to change another identity\'s status',
        function(done) {
          var actor = actors.alpha;
          var testIdentity = actors.admin;
          brIdentity
            .setStatus(actor, testIdentity.id, 'deleted', function(err) {
              should.exist(err);
              err.name.should.equal('PermissionDenied');
              err.details.sysPermission.should.equal('IDENTITY_ADMIN');
              done();
            });
        });
    });
    describe('admin user', function() {
      it('should mark an identity deleted, then active', function(done) {
        var actor = actors.admin;
        var testIdentity = actors['will-b-disabled'];
        async.auto({
          deleteIdentity: function(callback) {
            brIdentity.setStatus(actor, testIdentity.id, 'deleted', callback);
          },
          checkStatusDeleted: ['deleteIdentity', function(callback) {
            database.collections.identity.findOne({
              id: database.hash(testIdentity.id)
            }, function(err, record) {
              should.not.exist(err);
              should.exist(record.identity);
              var i = record.identity;
              i.sysStatus.should.equal('deleted');
              callback();
            });
          }],
          activateIdentity: ['checkStatusDeleted', function(callback) {
            brIdentity.setStatus(actor, testIdentity.id, 'active', callback);
          }],
          checkStatusActive: ['activateIdentity', function(callback) {
            database.collections.identity.findOne({
              id: database.hash(testIdentity.id)
            }, function(err, record) {
              should.not.exist(err);
              should.exist(record.identity);
              var i = record.identity;
              i.sysStatus.should.equal('active');
              callback();
            });
          }]
        }, done);
      });
    });
  });
  describe('get API', function() {
    describe('null actor', function() {
      it('should return error on non-existent identity', function(done) {
        brIdentity.get(null, 'https://example.com/i/nobody', function(err, i) {
          should.exist(err);
          should.not.exist(i);
          err.name.should.equal('NotFound');
          done();
        });
      });
      it('return identity when active option is not specified', function(done) {
        var testIdentity = actors['will-b-disabled'];
        async.auto({
          deleteIdentity: function(callback) {
            brIdentity.setStatus(null, testIdentity.id, 'deleted', callback);
          },
          getIdentity: ['deleteIdentity', function(callback) {
            brIdentity.get(null, testIdentity.id, function(err, i) {
              should.not.exist(err);
              should.exist(i);
              i.should.be.an('object');
              i.sysStatus.should.equal('deleted');
              callback();
            });
          }],
          activateIdentity: ['getIdentity', function(callback) {
            brIdentity.setStatus(null, testIdentity.id, 'active', callback);
          }]
        }, done);
      });
      it('returns not found error when active option is specified',
        function(done) {
          var testIdentity = actors['will-b-disabled'];
          async.auto({
            deleteIdentity: function(callback) {
              brIdentity.setStatus(null, testIdentity.id, 'deleted', callback);
            },
            getIdentity: ['deleteIdentity', function(callback) {
              brIdentity
                .get(null, testIdentity.id, {active: true}, function(err, i) {
                  should.exist(err);
                  should.not.exist(i);
                  err.name.should.equal('NotFound');
                  callback();
                });
            }],
            activateIdentity: ['getIdentity', function(callback) {
              brIdentity.setStatus(null, testIdentity.id, 'active', callback);
            }]
          }, done);
        });
    }); // end null actor
    describe('regular user', function() {
      it('should be able to access itself', function(done) {
        var actor = actors.alpha;
        var testIdentity = actors.alpha;
        brIdentity.get(actor, testIdentity.id, function(err, i) {
          should.not.exist(err);
          should.exist(i);
          i.id.should.equal(testIdentity.id);
          i.sysSlug.should.equal(testIdentity.sysSlug);
          i.sysStatus.should.equal('active');
          done();
        });
      });
      it('should not be able to access another identity', function(done) {
        var actor = actors.alpha;
        var testIdentity = actors.admin;
        brIdentity.get(actor, testIdentity.id, function(err, i) {
          should.exist(err);
          should.not.exist(i);
          err.name.should.equal('PermissionDenied');
          done();
        });
      });
    }); // end regular user
    describe('admin user', function() {
      it('should be able to access itself', function(done) {
        var actor = actors.admin;
        var testIdentity = actors.admin;
        brIdentity.get(actor, testIdentity.id, function(err, i) {
          should.not.exist(err);
          should.exist(i);
          i.id.should.equal(testIdentity.id);
          i.sysSlug.should.equal(testIdentity.sysSlug);
          i.sysStatus.should.equal('active');
          done();
        });
      });
      it('should be able to access another identity', function(done) {
        var actor = actors.admin;
        var testIdentity = actors.alpha;
        brIdentity.get(actor, testIdentity.id, function(err, i) {
          should.not.exist(err);
          should.exist(i);
          i.id.should.equal(testIdentity.id);
          done();
        });
      });
    }); // end admin user
  }); // end get API
  describe('insert API', () => {
    describe('null actor', () => {
      it('should insert an identity in the database', done => {
        var userName = 'de3c2700-0c5d-4b75-bd6b-02dee985e39d';
        var newIdentity = helpers.createIdentity(userName);
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            database.collections.identity.findOne(
              {id: database.hash(newIdentity.id)}, (err, results) => {
                var meta = results.meta;
                should.exist(meta.created);
                meta.created.should.be.a('number');
                should.exist(meta.updated);
                meta.updated.should.be.a('number');
                var identity = results.identity;
                identity.id.should.equal('https://example.com/i/' + userName);
                identity.type.should.equal('Identity');
                identity.sysSlug.should.equal(userName);
                identity.label.should.equal(userName);
                identity.email.should.equal(userName + '@bedrock.dev');
                identity.sysPublic.should.be.an('array');
                identity.sysPublic.should.have.length(0);
                identity.sysResourceRole.should.be.an('array');
                identity.sysResourceRole.should.have.length(0);
                identity.url.should.equal('https://example.com');
                identity.description.should.equal(userName);
                identity.sysStatus.should.equal('active');
                callback();
              });
          }]
        }, done);
      });
      it('should return error on duplicate identity', done => {
        var userName = '99748241-3599-41a0-8445-d092de558b9f';
        var newIdentity = helpers.createIdentity(userName);
        async.auto({
          insertAlpha: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          insertBeta: ['insertAlpha', callback => {
            // attempt to insert the same identity again
            brIdentity.insert(null, newIdentity, (err, result) => {
              should.exist(err);
              should.not.exist(result);
              database.isDuplicateError(err).should.be.true;
              callback();
            });
          }]
        }, done);
      });
      it('should properly generate a resource ID for one role', done => {
        var userName = '15065125-6e65-4f2e-9736-bb49aee468a4';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.regular',
          generateResource: 'id'
        });
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            database.collections.identity.findOne(
              {id: database.hash(newIdentity.id)}, (err, results) => {
                var meta = results.meta;
                should.exist(meta.created);
                meta.created.should.be.a('number');
                should.exist(meta.updated);
                meta.updated.should.be.a('number');
                var identity = results.identity;
                identity.id.should.equal('https://example.com/i/' + userName);
                identity.type.should.equal('Identity');
                identity.sysSlug.should.equal(userName);
                identity.label.should.equal(userName);
                identity.email.should.equal(userName + '@bedrock.dev');
                identity.sysPublic.should.be.an('array');
                identity.sysPublic.should.have.length(0);
                identity.url.should.equal('https://example.com');
                identity.description.should.equal(userName);
                identity.sysStatus.should.equal('active');
                // test sysResourceRole
                identity.sysResourceRole.should.be.an('array');
                identity.sysResourceRole.should.have.length(1);
                testRole(
                  identity.sysResourceRole[0], 'bedrock-identity.regular',
                  ['https://example.com/i/' + userName]);
                callback();
              });
          }]
        }, done);
      });
      it('returns error if generateResouce !== `id`', done => {
        var userName = 'e29ea95f-fb91-4a03-8bdf-26d254caa953';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.regular',
          generateResource: 'notId'
        });
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, (err, result) => {
              should.not.exist(result);
              should.exist(err);
              err.name.should.equal('InvalidResourceRole');
              err.message.should.equal(
                'Could not create Identity; unknown ResourceRole rule.');
              err.details.should.be.an('object');
              err.details.sysResourceRole.should.be.an('object');
              err.details.sysResourceRole.sysRole
                .should.equal('bedrock-identity.regular');
              err.details.sysResourceRole.generateResource
                .should.equal('notId');
              callback();
            });
          }
        }, done);
      });
      it('generates a resource ID for one role with other resources', done => {
        var userName = '9d8a65ad-ab7c-407a-b818-e3a090680673';
        var altName = 'b7f24a46-9128-4aec-ab3d-1e9d7770f7da';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.regular',
          generateResource: 'id',
          resource: ['https://example.com/i/' + altName]
        });
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            database.collections.identity.findOne(
              {id: database.hash(newIdentity.id)}, (err, results) => {
                var meta = results.meta;
                should.exist(meta.created);
                meta.created.should.be.a('number');
                should.exist(meta.updated);
                meta.updated.should.be.a('number');
                var identity = results.identity;
                identity.id.should.equal('https://example.com/i/' + userName);
                identity.type.should.equal('Identity');
                identity.sysSlug.should.equal(userName);
                identity.label.should.equal(userName);
                identity.email.should.equal(userName + '@bedrock.dev');
                identity.sysPublic.should.be.an('array');
                identity.sysPublic.should.have.length(0);
                identity.url.should.equal('https://example.com');
                identity.description.should.equal(userName);
                identity.sysStatus.should.equal('active');
                // test sysResourceRole
                identity.sysResourceRole.should.be.an('array');
                identity.sysResourceRole.should.have.length(1);
                testRole(
                  identity.sysResourceRole[0], 'bedrock-identity.regular',
                  ['https://example.com/i/' + userName,
                  'https://example.com/i/' + altName]);
                callback();
              });
          }]
        }, done);
      });
      it('should properly generate a resource ID for three roles', done => {
        var userName = '6ed0734c-8a29-499f-8a21-eb3bd7923620';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.alpha',
          generateResource: 'id'
        });
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.beta',
          generateResource: 'id'
        });
        newIdentity.sysResourceRole.push({
          sysRole: 'bedrock-identity.gamma',
          generateResource: 'id'
        });
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            database.collections.identity.findOne(
              {id: database.hash(newIdentity.id)}, (err, results) => {
                var meta = results.meta;
                should.exist(meta.created);
                meta.created.should.be.a('number');
                should.exist(meta.updated);
                meta.updated.should.be.a('number');
                var identity = results.identity;
                identity.id.should.equal('https://example.com/i/' + userName);
                identity.type.should.equal('Identity');
                identity.sysSlug.should.equal(userName);
                identity.label.should.equal(userName);
                identity.email.should.equal(userName + '@bedrock.dev');
                identity.sysPublic.should.be.an('array');
                identity.sysPublic.should.have.length(0);
                identity.url.should.equal('https://example.com');
                identity.description.should.equal(userName);
                identity.sysStatus.should.equal('active');
                // test sysResourceRole
                identity.sysResourceRole.should.be.an('array');
                identity.sysResourceRole.should.have.length(3);
                testRole(
                  identity.sysResourceRole[0], 'bedrock-identity.alpha',
                  ['https://example.com/i/' + userName]);
                testRole(
                  identity.sysResourceRole[1], 'bedrock-identity.beta',
                  ['https://example.com/i/' + userName]);
                testRole(
                  identity.sysResourceRole[2], 'bedrock-identity.gamma',
                  ['https://example.com/i/' + userName]);
                callback();
              });
          }]
        }, done);
      });
    });
  }); // end insert API
  describe('exists API', () => {
    describe('null actor', () => {
      it('returns false if identity does not exist', done => {
        var actor = null;
        var id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        brIdentity.exists(actor, id, (err, result) => {
          result.should.be.false;
          done();
        });
      });
      it('returns true if identity exists', done => {
        var actor = null;
        var userName = '9d8a34bb-6b3a-4b1a-b69c-322fbbd9536e';
        var newIdentity = helpers.createIdentity(userName);
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            brIdentity.exists(actor, newIdentity.id, (err, result) => {
              result.should.be.true;
              callback();
            });
          }]
        }, done);
      });
      it('returns false for deleted identity by default', done => {
        var actor = null;
        var userName = '8a354515-17cb-453d-b45a-5d3964706f9f';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysStatus = 'deleted';
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            brIdentity.exists(actor, newIdentity.id, (err, result) => {
              result.should.be.false;
              callback();
            });
          }]
        }, done);
      });
      it('returns true for deleted identity with deleted option', done => {
        var actor = null;
        var userName = '76fbb25e-514d-4566-b270-b08ff8989543';
        var newIdentity = helpers.createIdentity(userName);
        newIdentity.sysStatus = 'deleted';
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            brIdentity.exists(
              actor, newIdentity.id, {deleted: true}, (err, result) => {
                result.should.be.true;
                callback();
              });
          }]
        }, done);
      });
    }); // end null actor
    describe('regular user', () => {
      it('returns PermissionDenied when another user ID is specified', done => {
        var actor = actors.alpha;
        var id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        brIdentity.exists(actor, id, (err) => {
          should.exist(err);
          err.name.should.equal('PermissionDenied');
          err.details.sysPermission
            .should.equal('IDENTITY_ACCESS');
          done();
        });
      });
      it('returns true if own identity exists', done => {
        var actor = actors.alpha;
        brIdentity.exists(actor, actor.id, (err, result) => {
          result.should.be.true;
          done();
        });
      });
    }); // end regular user
    describe('admin user', () => {
      it('returns false if identity does not exist', done => {
        var actor = actors.admin;
        var id = 'e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        brIdentity.exists(actor, id, (err, result) => {
          result.should.be.false;
          done();
        });
      });
      it('returns true if identity exists', done => {
        var actor = actors.admin;
        var userName = '474af20b-fdf8-472b-a22a-b510bebf452f';
        var newIdentity = helpers.createIdentity(userName);
        async.auto({
          insert: callback => {
            brIdentity.insert(null, newIdentity, callback);
          },
          test: ['insert', callback => {
            brIdentity.exists(actor, newIdentity.id, (err, result) => {
              result.should.be.true;
              callback();
            });
          }]
        }, done);
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
