# ADR 0004: Explainable token cost estimates

Status: Accepted

## Context

Provider pricing depends on the model, context length, service tier and cache operations. Missing usage or unsupported tariffs cannot establish a zero-dollar run. Updating a catalog must not silently change estimates already captured with calls.

## Decision

Calculate quotes with a pure domain function over normalized usage and a versioned, source-linked tariff catalog. Provider adapters extract billing metadata. Store each new quote with its span before truncating the raw response; validate it when reading from Postgres.

Quotes distinguish complete, partial and unknown token estimates. Known subtotals remain separate from unknown totals. Aggregate per-call quotes rather than applying a single tariff to an entire run. Existing spans without a quote are explicitly repriced with the current catalog.

The without-cache scenario prices the same input and output volumes without cache reads or writes. It does not predict model quality, future cache hits or changes to tokenization. Budgets are browser-local reminders based on accumulated known spend, not enforcement controls.

## Consequences

New recorded quotes remain stable across future catalog updates. Legacy data may be incomplete, especially when response payloads were truncated. Unsupported tiers remain unpriced until their rates are verified. Estimates cover token usage only and exclude paid tools, storage, taxes, negotiated discounts and subscription billing.
