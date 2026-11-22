import hashlib
import secrets

from settings import get_settings


def generate_api_key() -> str:
    auth_secret = get_settings().auth_secret
    return hashlib.sha256(auth_secret.encode("utf-8")).hexdigest()


def verify_api_key(api_key: str) -> bool:
    return api_key.isascii() and secrets.compare_digest(
        generate_api_key(), api_key
    )
