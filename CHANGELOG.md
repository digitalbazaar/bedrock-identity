# bedrock-identity ChangeLog

## [Unreleased]

### Fixed
- `checkKeyPair()` workaround to try to detect invalid private key vs invalid
  key pair.

### Changed
- Add abstraction layer to use `crypto` and fallback to `ursa`.
- Check buffers with `buffer-equal` to fix node 0.10.x compatibility.
- Moved key functionality to `bedrock-key`.

## [1.0.2] - 2015-07-16

### Changed
- Catch `ursa` exceptions and return Bedrock errors.

## [1.0.1] - 2015-05-07

### Fixed
- Fix database result access.

## [1.0.0] - 2015-04-08

### Security
- Log identity **after** password hashing.

## 0.1.0 (up to early 2015)

- See git history for changes.

[Unreleased]: https://github.com/digitalbazaar/bedrock-identity/compare/1.0.2...HEAD
[1.0.2]: https://github.com/digitalbazaar/bedrock-identity/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/digitalbazaar/bedrock-identity/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/digitalbazaar/bedrock-identity/compare/0.1.0...1.0.0
