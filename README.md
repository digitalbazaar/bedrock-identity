# bedrock-identity

[![Bedrock Node.js CI](https://github.com/digitalbazaar/bedrock-identity/workflows/Bedrock%20Node.js%20CI/badge.svg)](https://github.com/digitalbazaar/bedrock-identity/actions?query=workflow%3A%22Bedrock+Node.js+CI%22)

Bedrock identity

## Requirements

- npm v3+

TODO

## Mail Triggers

### getIdentity

Set `identity` in mail event details.

```js
// send email
bedrock.events.emitLater({
  type: 'myModule.myEvent',
  details: {
    triggers: ['getIdentity'],
    // other event data
    ...
  }
});
```
