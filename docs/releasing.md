# Release checklist

The private development repository is the working source. The public source is at bugdeployer/Horus. Python SDK 0.4.0b1 is published on PyPI. The CLI, JavaScript SDK, and PHP SDK 0.4.0-beta.1 are published on npm and Packagist.

## Build

Install development dependencies and console npm dependencies first. Stop the running source console before rebuilding it.

```sh
python scripts/build_release.py
python -m twine check dist/horus_sdk-0.4.0b1* dist/horus_workspace-0.4.0b1*
python scripts/smoke_install.py --audit
python scripts/validate_release.py
python scripts/smoke_php.py --composer /path/to/composer.phar
```

The builder exports the Next.js console, includes it in the workspace wheel, packs the Python SDK and npm packages, and creates a PHP archive plus SHA256SUMS. It does not publish or run registry login commands. PHP archives are not Python source distributions; do not pass them to twine.

For a new version, use a fresh dist directory and update package/CLI version metadata together. Old files should not be included in a release. The workspace wheel embedded in the CLI must match its version.

## Validation

- Run Python, Node, PHP, browser, and MCP checks.
- Run the packed installation smoke on Windows, Linux, and macOS. Verify paths with spaces, start/status/stop, restart persistence, static assets, Python capture, and Node delivery.
- Validate composer.json and the PHP distribution from its extracted archive.
- Confirm package contents exclude tests, captures, databases, development paths, and credentials.
- Keep full GPL-3.0-only license text with each distribution. Retain dependency license metadata.
- Run `python scripts/prepare_public.py` from a clean committed tree. Run `python scripts/validate_release.py --public-source` to verify the source archive and artifacts before creating the first public commit.

## Public source

When approved, rename the old private repository to Horus-development and create bugdeployer/Horus. Prepare a clean snapshot with one `initial beta release` commit. State that it is the initial public snapshot of an existing AI-assisted project. Preserve development history in the private repository; do not invent dates or prior manual authorship.

The SDKs stay in this monorepo. Packagist needs a distribution repository with composer.json at its root. The generated repository is bugdeployer/horus-sdk-php. Copy releases from packages/sdk-php, preserve DISTRIBUTION.md, validate composer.json, and tag the version there. Keep the canonical Horus source link. Verify the new version is indexed on Packagist; trigger a manual update from its Manage menu if needed. The root composer manifest is not the PHP SDK.

## Publish

The public repository has a manual `publish-python.yml` workflow for `horus-sdk`. Run it on main with `publish` unchecked to build, check metadata, and test delivery from the installed wheel. Select `publish` only when releasing to PyPI. The publish job uses the `pypi` environment and PyPI Trusted Publishing; no API token is stored. It uploads only the Python SDK, not the workspace or other runtimes.

Publishing requires maintainer approval and registry account access. Use 0.4.0b1 for Python and 0.4.0-beta.1 for npm/PHP. Publish npm packages under the beta dist-tag. Test actual registry installs before adding links to README. Keep links blank until packages exist.

Do not claim production readiness or unsupported platform coverage. See verification.md for the latest checks and open limits.

The artifact preflight rejects checksum drift, source/package mismatches, missing licenses, unsafe archive paths, and development files in distributed packages. The CLI payload must contain the exact workspace wheel being released. Clean-install CI audits the installed third-party Python dependencies; unpublished Horus packages are verified from source instead. npm production dependencies are audited before packaging.
