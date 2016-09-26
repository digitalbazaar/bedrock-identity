/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* globals describe, it, before, should */
/* jshint node: true */
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
    describe('regular user', function() {
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
    }); // end regular user
  });
});
