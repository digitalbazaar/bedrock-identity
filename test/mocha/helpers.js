/*
 * Copyright (c) 2015-2018 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

const brIdentity = require('bedrock-identity');
const database = require('bedrock-mongodb');
const {promisify} = require('util');

const api = {};
module.exports = api;

api.createIdentity = userName => {
  const newIdentity = {
    id: 'https://example.com/i/' + userName,
    label: userName,
    email: userName + '@bedrock.dev',
    url: 'https://example.com',
    description: userName
  };
  return newIdentity;
};

api.getActors = async mockData => {
  const actors = {};
  for(const [key, record] of Object.entries(mockData.identities)) {
    actors[key] = await brIdentity.getCapabilities({id: record.identity.id});
  }
  return actors;
};

api.prepareDatabase = mockData => {
  await api.removeCollections();
  await insertTestData(mockData);
};

api.randomDate = (start, end) =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));

api.removeCollections = async (collectionNames = ['identity']) => {
  await promisify(database.openCollections)(collectionNames);
  for(const collectionName of collectionNames) {
    await database.collections[collectionName].remove({});
  }
};

api.removeCollection =
  async collectionName => api.removeCollections([collectionName]);

async function insertTestData(mockData) {
  for(const record of mockData.identities) {
    try {
      await brIdentity.insert(
        {actor: null, identity: record.identity, meta: record.meta || {}});
    } catch(e) {
      if(e.name === 'DuplicateError') {
        // duplicate error means test data is already loaded
        continue;
      }
      throw e;
    }
  }
}
