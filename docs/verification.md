# Verification

## Beta packaging

Private CI covers application checks, container startup, package builds, and clean installs on Windows, Linux, and macOS. A Linux/Python 3.11 job checks the minimum Python version. Results are recorded in the private repository Actions history.

Local checks passed: 48 Python tests, seven Node SDK tests, PHP SDK checks, TypeScript declarations, a static Next.js export, and 12 browser tests against the exported workspace. Python wheels and source distributions passed twine checks. Composer metadata passed strict validation. The npm production dependency audit reported no known vulnerabilities at the time of preparation; that is not a security guarantee.

The packed-install smoke runs outside the checkout, in a path containing spaces. It installs the npm CLI and SDK tarballs, sets up an isolated Python runtime, starts and stops the workspace, loads CSS/JS, imports a capture from the installed Python wheel, delivers a Node capture automatically, and checks persistence after restart. CI repeats this flow on three operating systems.

GPL-3.0-only text ships with each package. The workspace retains notices for bundled frontend dependencies. Packaged contents were checked for test fixtures, databases, and credentials. The source export excludes local artifacts and historical identity mapping.

## Runtime coverage

Task Swamp is an independent-style Python HTTP integration fixture. Tests launch the actual app and collector in separate processes with temporary storage. They cover create/read/update/delete, mixed-field updates, validation atomicity, missing records, automatic delivery, expectations, and topology evidence.

Other runtimes have focused SDK tests, not broad external-framework validation. Topology checks cover parent/child evidence, exact heat totals, project boundaries, recursion, overlapping async calls, source references, and cell-specific examples. Browser checks cover navigation, comparisons, imports, themes, monitoring, maps, filters, and responsive overflow. The MCP smoke calls all seven read-only tools over stdio.

## Limits

No package is published yet. Registry account authorization and real registry installation tests remain release steps. The public repository has not been created. There are no production usage, performance, or debugging-time claims.

Static whole-repository analysis, automatic data lineage, WebSocket updates, instance heartbeats, and distributed propagation are not implemented. Sustained load, worker crashes, and broader independent framework integration still need validation.

## Pre-publication dependency review

The review found advisories in the previously installed Starlette 0.50.0 and virtual-environment pip 26.1.2. The workspace now pins FastAPI 0.162.0 and Starlette 1.10.0; CLI setup installs pip 26.2.2 and setuptools 84.2.1 before workspace dependencies. The minimum-Python CI check caught an older setuptools supplied by Python 3.11 venv; it is updated instead of ignored. The updated clean Python install audit reported no known vulnerabilities in the registry packages it could audit. Unpublished Horus distributions are skipped by the registry audit and checked against source by the artifact validator. This is not a guarantee that the software has no vulnerabilities.

The PHP archive was extracted and installed through a local Composer path repository with plugins and scripts disabled, then exercised through Composer autoloading, nested scopes, captured values, and the worker entry point. The artifact validator also checks GPL text, metadata, SHA256SUMS, embedded wheel identity, source parity, and unsafe or duplicate archive paths.
