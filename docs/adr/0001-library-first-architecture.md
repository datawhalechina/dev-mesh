# ADR: Library-First Architecture

Status: Accepted  
Date: 2026-06-06

## Context

The technical design requires DevMesh to work as a CLI product, a local MCP proxy, a hub server, and a reusable library surface for Agent, IDE, CI, and enterprise integrations.

## Decision

The monorepo is organized around reusable packages first. `apps/*` only parse arguments, assemble dependencies, and manage process lifecycle. Domain rules live in `packages/core`; Agent context orchestration lives in `packages/agent`; local runtime lives in `packages/client`; hub behavior lives in `packages/server`; extension contracts live in `packages/extension-api`.

## Consequences

Core code stays independent from tool adapters, MCP hosts, storage engines, and HTTP servers. New adapters, providers, redactors, scorers, search backends, and sync backends are added through `packages/registry` and the interfaces in `packages/extension-api`.
