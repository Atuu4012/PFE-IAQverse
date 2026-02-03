import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

supabase = None

try:
    from supabase import create_client, Client
    
    url: str = os.getenv("SUPABASE_URL")
    key: str = os.getenv("SUPABASE_KEY")
    
    if url and key:
        try:
            supabase: Optional[Client] = create_client(url, key)
            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
    else:
        logger.warning("Supabase credentials (SUPABASE_URL, SUPABASE_KEY) not found. Supabase features disabled.")

except ImportError:
    pass
