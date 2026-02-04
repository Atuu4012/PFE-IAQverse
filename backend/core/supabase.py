import os
import logging
import base64
import json
from typing import Optional

logger = logging.getLogger(__name__)

supabase = None

try:
    from supabase import create_client, Client
    
    url: str = os.getenv("SUPABASE_URL")
    key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    
    # Debug info (partially masked)
    log_url = url if url else "None"
    log_key = f"{key[:5]}..." if key and len(key) > 5 else ("Present" if key else "None")

    def _extract_role_from_jwt(token: str) -> Optional[str]:
        try:
            parts = token.split(".")
            if len(parts) < 2:
                return None
            payload = parts[1]
            padding = "=" * (-len(payload) % 4)
            decoded = base64.urlsafe_b64decode(payload + padding)
            data = json.loads(decoded.decode("utf-8"))
            return data.get("role")
        except Exception:
            return None

    role = _extract_role_from_jwt(key) if key else None
    key_source = "SUPABASE_SERVICE_ROLE_KEY" if os.getenv("SUPABASE_SERVICE_ROLE_KEY") else "SUPABASE_KEY"
    logger.info(f"Initializing Supabase with URL: {log_url}, KEY: {log_key} ({key_source}), role: {role}")

    if url and key:
        try:
            supabase: Optional[Client] = create_client(url, key)
            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
    else:
        logger.warning(f"Supabase credentials missing. URL found: {bool(url)}, Key found: {bool(key)}. Supabase features disabled.")

except ImportError:
    pass
