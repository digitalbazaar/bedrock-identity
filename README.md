# bedrock-identity

[![Build Status](http://ci.digitalbazaar.com/buildStatus/icon?job=bedrock-identity)](http://ci.digitalbazaar.com/job/bedrock-identity)

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
