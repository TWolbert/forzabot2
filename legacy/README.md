# Archived original implementation

This directory is the pre-Rust implementation of ForzaBot, kept for reference
and migration history. It is **not built or run** by the Docker image, and the
repository root's tooling does not reference it.

It contains the former Bun/TypeScript Discord bot, the Bun/React API and
dashboard, and the Python data/icon generators. The active implementation is in
`../rust/`.

If a feature still needs to be compared against the old behavior, run it from
this directory with its original Bun/Python setup; do not deploy it alongside
the Rust bot using the same Discord token.
