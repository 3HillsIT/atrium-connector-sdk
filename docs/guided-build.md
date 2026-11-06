# The guided build

This page will hold a procedure that a developer and their coding agent follow together to build a new Connector, one step at a time: the system and its API docs, how it signs in, what the admin enters on the Integration, the Actions and which of them write, writing and testing each Action, and the hand-off of the steps that are the developer's. It ships once it has been tried on real systems with more than one coding agent.

It isn't written yet. Until it is, start from the repo `atrium-connector init` writes ([build-and-sign.md](build-and-sign.md#init)) and build the Connector by hand, in this order:

1. [concepts.md](concepts.md): what atrium reads and what it runs.
2. [manifest.md](manifest.md): the manifest and how the system signs in. If no sign-in kind fits the system, stop there: atrium can't sign in to it yet.
3. [actions.md](actions.md): one Action at a time. Decide with the person you build for which Actions write, by name, before you write them.
4. [testing.md](testing.md): its tests.
5. [build-and-sign.md](build-and-sign.md): `check`, then `build --try` for a test Instance. Signing is a person's step.

A coding agent working on a Connector reads the same pages, and never runs `sign`.
