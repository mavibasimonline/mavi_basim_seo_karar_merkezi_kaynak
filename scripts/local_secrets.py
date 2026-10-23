"""Create local-only credentials without displaying them or overwriting existing settings."""
import base64
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / '.dev.vars'
try:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('Mevcut .dev.vars korundu.')
else:
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(f'ADMIN_TOKEN={secrets.token_urlsafe(32)}\n')
        handle.write(f'TOKEN_ENCRYPTION_KEY={base64.b64encode(os.urandom(32)).decode()}\n')
    print('Yerel .dev.vars oluşturuldu; değerler loglanmadı.')
