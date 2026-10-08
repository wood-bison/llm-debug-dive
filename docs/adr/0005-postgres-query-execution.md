# ADR 0005: Reliable concurrent Postgres reads

Status: Accepted

## Context

Concurrent trace requests reproduced Bun 1.3.14's `ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE` decode failure. The same queries passed sequentially. The symptoms match [Bun issue 33665](https://github.com/oven-sh/bun/issues/33665).

## Decision

Configure Bun SQL with `prepare: false`. According to [Bun's SQL documentation](https://bun.sh/docs/runtime/sql#prepared-statements), this uses unnamed prepared statements and disables pipelining. Connection pooling and parameter binding remain enabled.

## Consequences

Five batches of six concurrent trace requests passed after the change, followed by the quote persistence and API contract checks. Postgres parses and plans each query again, trading some execution overhead for reliable reads on the pinned runtime. Reconsider this setting after a Bun upgrade with a verified fix and the same concurrent workload.
