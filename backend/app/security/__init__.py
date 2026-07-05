"""Server-side security primitives.

Crypto (Argon2id hashing, AES-256-GCM), allowlist input validation, NRIC masking,
and (added later) sessions, decorators, and lockout. All security decisions live
here, never in the presentation layer.
"""
