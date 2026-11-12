# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a problem

Please **don't** open a public issue for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's Security tab).

Include what you found, how to reproduce it, and the impact you expect. We aim to reply within 7 days and to ship a fix or mitigation as soon as we can, crediting you if you want.

## Scope

Hoard runs locally and does not send your files anywhere. Issues of particular interest: reading or writing files outside the open library, running commands through crafted file names or links, and crashes caused by malformed files during import.
