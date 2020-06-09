# bedrock-identity ChangeLog

## 8.0.0 -

### Changed
  - **BREAKING**: Upgrad to `bedrock-mongodb` ^7.0.0.
  - Changed mongo apis to match mongo driver 3.5.
  - peerDependency for `bedrock-permission` ^3.0.0.

### Added
  - Find methods now accept options.projections.
  - Find will throw if both fields and options.projections are set.

## 7.0.1 - 2019-11-12

### Changed
- Update max bedrock dependency.

## 7.0.0 - 2019-10-21

### Changed
- **BREAKING**: Refactor module for use with bedrock@2.
- **BREAKING**: Remove identity and security contexts.

## 6.1.0 - 2018-12-03

### Changed
- Use bedrock-validation@4.

## 6.0.0 - 2018-09-17

### Changed
- Use bedrock-validation 3.x.

## 5.0.1 - 2018-06-14

### Changed
- Use bedrock-permission 2.5.x and simplify code.

## 5.0.0 - 2018-06-12

### Added
- Add `validateCapabilityDelegation` public API. Callers may use to ensure
  that an actor has the capabilities required to delegate the given
  capabilities (represented as resource roles) to another entity.
- Pass `originalResource` in `bedrock-identity.delegateCapability.translate`
  event. Resource translators can use this to ensure they are translating
  for the original resource not one that has already been translated.
- Pass `newResources`, a map of resource ID => new resource, in
  `bedrock-identity.delegateCapability.translate` to allow for performing
  translation on resources that are in the process of being created and
  therefore cannot be retrieved from a database.
- Add `updateRoles` API.

### Removed
- ***BREAKING*** Remove `checkPermission` public API. Previous callers
  should use `bedrock-permission` module's `checkPermission` instead.
- ***BREAKING*** Remove `IDENTITY_ADMIN` permission. Use granular permissions
  like `IDENTITY_META_UPDATE` instead.
- ***BREAKING*** Remove `setRoles` API. Replaced with `updateRoles`.

### Changed
- Update `bedrock-mongodb` peer dependency.
- Update test dependencies.
- ***BREAKING*** `update` API now uses JSON patch and requires a sequence
  number that must match the current record, prior to applying the patch.
- Rename `IDENTITY_EDIT` permission to `IDENTITY_UPDATE`.
- ***BREAKING*** Throw `BedrockError` of type `DuplicateError` rather than
  mongodb duplicate error.
- ***BREAKING*** Replace `setRoles` API with `updateRoles` API that requires
  `add` and/or `remove` parameters to be passed with resource roles rather than
  a single `resourceRoles` parameter to wholesale replace the identity's roles
  (which are used to compute capabilities).

## 4.6.0 - 2017-03-02

### Added
- Add support for group membership.

## 4.5.1 - 2017-01-25

### Changed
- Update local cache of `identity-v1` context.

## 4.5.0 - 2016-11-10

### Added
- Add `options` parameter to `exists` API.

## 4.4.0 - 2016-11-10

### Added
- Implement `exists` API.

## 4.3.0 - 2016-11-07

### Added
- Implement `generateResource` API.
- Tests for `insert` API.

## 4.2.4 - 2016-10-06

### Fixed
- Use `IDENTITY_ACCESS` instead of `IDENTITY_ADMIN` for getting
  all identities (note: the permission must have no restriction
  restriction for the permission check to pass).

## 4.2.3 - 2016-09-26

### Changed
- Restructure test framework for CI.

## 4.2.2 - 2016-06-20

### Fixed
- Add existence checks before transforming roles.

## 4.2.1 - 2016-06-07

### Changed
- Update dependencies.

## 4.2.0 - 2016-05-23

### Added
- Use the config to model identity object updates.

## 4.1.0 - 2016-05-09

### Added
- New `postInsert` event.

## 4.0.2 - 2016-04-30

### Changed
- Remove plaintext passcode and password from new identities.

## 4.0.1 - 2016-04-26

## 4.0.0 - 2016-04-26

### Changed
- Transform the roles contained in identities to URLs.

## 3.0.2 - 2016-04-19

### Fixed
- Do not remove plaintext password and passcode.

## 3.0.1 - 2016-04-15

### Changed
- Update bedrock dependencies.

## 3.0.0 - 2016-03-02

### Changed
- Update package dependencies for npm v3 compatibility.

## 2.0.0 - 2016-01-31

### Changed
- **BREAKING**: Moved key functionality to `bedrock-key`.

## 1.0.2 - 2015-07-16

### Changed
- Catch `ursa` exceptions and return Bedrock errors.

## 1.0.1 - 2015-05-07

### Fixed
- Fix database result access.

## 1.0.0 - 2015-04-08

### Security
- Log identity **after** password hashing.

## 0.1.0 (up to early 2015)

- See git history for changes.
