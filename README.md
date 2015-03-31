# bedrock-identity
Bedrock identity

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
