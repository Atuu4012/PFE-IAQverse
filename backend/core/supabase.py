import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

supabase = None

try:
    from supabase import create_client, Client
    
    url: str = os.getenv("SUPABASE_URL")
    key: str = os.getenv("SUPABASE_KEY")
    
    # Debug info (partially masked)
    log_url = url if url else "None"
    log_key = f"{key[:5]}..." if key and len(key) > 5 else ("Present" if key else "None")
    logger.info(f"Initializing Supabase with URL: {log_url}, KEY: {log_key}")

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
