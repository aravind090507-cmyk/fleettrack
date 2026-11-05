"""
Password hashing using Argon2id with resilient fallback to hashlib PBKDF2-HMAC-SHA256.
Guarantees zero C-compiler/link.exe build dependencies across Python 3.12, 3.13, and 3.14+.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError
    _hasher = PasswordHasher()
    _USE_ARGON2 = True
except ImportError:
    _hasher = None
    _USE_ARGON2 = False


def hash_password(plain: str) -> str:
    """Hash a plaintext password with salt."""
    if _USE_ARGON2 and _hasher:
        return _hasher.hash(plain)

    # Built-in fallback: PBKDF2-HMAC-SHA256 (Python Standard Library, 0 external deps)
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, 100_000)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    key_b64 = base64.b64encode(key).decode("ascii")
    return f"pbkdf2_sha256${salt_b64}${key_b64}"


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against an Argon2 or PBKDF2 hash."""
    if hashed.startswith("$argon2"):
        if _USE_ARGON2 and _hasher:
            try:
                return _hasher.verify(hashed, plain)
            except VerifyMismatchError:
                return False
            except Exception:
                return False
        return False

    if hashed.startswith("pbkdf2_sha256$"):
        try:
            _, salt_b64, key_b64 = hashed.split("$")
            salt = base64.b64decode(salt_b64.encode("ascii"))
            expected_key = base64.b64decode(key_b64.encode("ascii"))
            computed_key = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, 100_000)
            return hmac.compare_digest(expected_key, computed_key)
        except Exception:
            return False

    # Plain comparison fallback for dev safety
    return plain == hashed
