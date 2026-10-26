# Engineering ownership and AI assistance

Horus is a personal project by [bugdeployer](https://github.com/bugdeployer). bugdeployer leads the engineering and makes the final architectural and implementation decisions.

That work includes defining the runtime observation model, setting language and integration requirements, shaping the developer interface, evaluating technical tradeoffs, and directing testing and iterative refinement. AI suggestions are inputs to that process; engineering direction and acceptance remain with bugdeployer.

OpenAI Codex assisted with application and SDK implementation, tests, interface code, CI configuration, and documentation. This is AI-assisted programming, and the repository does not claim that all code was typed manually or produced without assistance.

## Development history

Commits describe actual work at meaningful milestones. Dates have not been backdated, mistakes manufactured, or a prior human development history invented. The private development history is retained; `.mailmap` maps the maintainer's earlier local Git identity to bugdeployer for display. An initial public snapshot will identify itself as a snapshot, not a fabricated development history. New commits use bugdeployer and the account's GitHub no-reply address.

## Evidence and limitations

Runtime captures come from executing instrumented code, not authored model answers. Horus itself does not require an LLM; agents can inspect evidence through MCP. See [verification](docs/verification.md) for checks and known limits. Tests do not establish production readiness or zero overhead.
