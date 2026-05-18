# ADR 0001: Independent analysis boundaries

Domain rules and application use cases depend on typed ports rather than Hono, Postgres or provider payloads. The composition root wires adapters into those ports. This keeps recording and analysis testable without network calls; shared helpers must remain free of adapter dependencies.
