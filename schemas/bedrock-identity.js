/*!
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');

const schema = {
  title: 'Identity',
  // owner is not required
  required: ['id'],
  type: 'object',
  properties: {
    id: {
      type: 'string',
    },
    owner: {
      type: 'string',
    }
  },
  additionalProperties: true
};

module.exports = function(extend) {
  if(extend) {
    return bedrock.util.extend(true, bedrock.util.clone(schema), extend);
  }
  return schema;
};
