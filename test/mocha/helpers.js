/*
 * Copyright (c) 2015-2016 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

var async = require('async');
var brIdentity = require('bedrock-identity');
var database = require('bedrock-mongodb');

var api = {};
module.exports = api;

api.createIdentity = function(userName) {
  var newIdentity = {
    id: 'https://example.com/i/' + userName,
    type: 'Identity',
    sysSlug: userName,
    label: userName,
    email: userName + '@bedrock.dev',
    sysPublic: [],
    sysResourceRole: [],
    url: 'https://example.com',
    description: userName,
    sysStatus: 'active'
  };
  return newIdentity;
};

api.getActors = function(mockData, callback) {
  var actors = {};
  async.forEachOf(mockData.identities, function(identity, key, callback) {
    brIdentity.get(null, identity.identity.id, function(err, i) {
      actors[key] = i;
      callback(err);
    });
  }, function(err) {
    callback(err, actors);
  });
};

api.prepareDatabase = function(mockData, callback) {
  async.series([
    function(callback) {
      api.removeCollections(callback);
    },
    function(callback) {
      insertTestData(mockData, callback);
    }
  ], callback);
};

api.randomDate = function(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

api.removeCollections = function(callback) {
  var collectionNames = ['identity'];
  database.openCollections(collectionNames, function() {
    async.each(collectionNames, function(collectionName, callback) {
      database.collections[collectionName].remove({}, callback);
    }, function(err) {
      callback(err);
    });
  });
};

api.removeCollection = function(collection, callback) {
  var collectionNames = [collection];
  database.openCollections(collectionNames, function() {
    async.each(collectionNames, function(collectionName, callback) {
      database.collections[collectionName].remove({}, callback);
    }, function(err) {
      callback(err);
    });
  });
};

// Insert identities
function insertTestData(mockData, callback) {
  async.forEachOf(mockData.identities, function(identity, key, callback) {
    brIdentity.insert(null, identity.identity, callback);
  }, function(err) {
    if(err) {
      if(!database.isDuplicateError(err)) {
        // duplicate error means test data is already loaded
        return callback(err);
      }
    }
    callback();
  }, callback);
}
