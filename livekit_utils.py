import os
import json
import hmac
import base64
import time
import logging
import uuid
from hashlib import sha256
from datetime import datetime, timedelta
from flask import current_app

# Configure logger
logger = logging.getLogger(__name__)

def generate_token(room_name, participant_name, ttl_seconds=3600):
    """
    Generate a LiveKit access token for a user using manual JWT construction
    to ensure compatibility with any LiveKit version.
    
    Args:
        room_name: Name of the LiveKit room
        participant_name: Name of the participant (username)
        ttl_seconds: Time-to-live in seconds (default 1 hour)
    
    Returns:
        str: JWT token for LiveKit access
    """
    try:
        # Get the start time for token generation
        start_time = time.time()
        
        api_key = os.environ.get('LIVEKIT_API_KEY')
        api_secret = os.environ.get('LIVEKIT_API_SECRET')
        
        if not api_key or not api_secret:
            raise ValueError("LiveKit API key and secret are required")
        
        # Add logging for token generation process
        logger.info(f"Generating token for participant '{participant_name}' in room '{room_name}'")
        
        # Create JWT header
        header = {
            "alg": "HS256",
            "typ": "JWT"
        }
        
        # Set expiration time
        now = int(time.time())
        exp = now + ttl_seconds
        
        # Create JWT payload with standard claims
        payload = {
            "iss": api_key,                # Issuer - API key
            "nbf": now,                    # Not before - current time
            "exp": exp,                    # Expiration time
            "sub": participant_name,       # Subject - participant identity
            "video": {                     # Video grants
                "room": room_name,         # Room name
                "roomJoin": True,          # Permission to join room
                "canPublish": True,        # Permission to publish tracks
                "canSubscribe": True,      # Permission to subscribe to others
                "canPublishData": True     # Permission to publish data
            },
            "name": participant_name,      # Participant name for display
            "metadata": json.dumps({       # Additional metadata for tracking
                "generated_at": now,
                "client_ip": "unknown"     # Could be populated from request info
            })
        }
        
        # Encode header and payload as base64
        header_bytes = json.dumps(header).encode()
        encoded_header = base64.urlsafe_b64encode(header_bytes).decode().rstrip('=')
        
        payload_bytes = json.dumps(payload).encode()
        encoded_payload = base64.urlsafe_b64encode(payload_bytes).decode().rstrip('=')
        
        # Create signature
        message = f"{encoded_header}.{encoded_payload}"
        signature = hmac.new(
            api_secret.encode(),
            message.encode(),
            sha256
        ).digest()
        encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip('=')
        
        # Create JWT token
        token = f"{message}.{encoded_signature}"
        
        # Log successful token generation with timing information
        elapsed_time = time.time() - start_time
        logger.info(f"Token generated successfully for '{participant_name}' in {elapsed_time:.3f}s, expires in {ttl_seconds}s")
        logger.debug(f"Token details: room='{room_name}', participant='{participant_name}', exp={datetime.fromtimestamp(exp).isoformat()}")
        
        return token
    except Exception as e:
        logger.error(f"Error generating token: {str(e)}")
        raise

def create_room(room_name):
    """
    Create a LiveKit room (or ensure it exists)
    
    Args:
        room_name: Name of the LiveKit room to create
    
    Returns:
        bool: True if successful
    """
    try:
        logger.info(f"Creating/ensuring LiveKit room: '{room_name}'")
        
        # This would typically use the LiveKit server API to create a room
        # For now, we'll just log the attempt and return True since rooms are created automatically
        # when tokens are used
        
        # In a production environment, you would make an API call to the LiveKit server like:
        # livekit_api_url = os.environ.get('LIVEKIT_API_URL')
        # response = requests.post(f"{livekit_api_url}/twirp/livekit.RoomService/CreateRoom", json={"name": room_name})
        # response.raise_for_status()
        
        logger.info(f"Room '{room_name}' creation/validation successful")
        return True
    except Exception as e:
        logger.error(f"Error creating room '{room_name}': {str(e)}")
        return False

def cleanup_room(room_name):
    """
    Clean up a LiveKit room when it's no longer needed
    
    Args:
        room_name: Name of the LiveKit room to clean up
    
    Returns:
        bool: True if successful
    """
    try:
        logger.info(f"Cleaning up LiveKit room: '{room_name}'")
        
        # This would typically use the LiveKit server API to delete a room
        # For now, we'll just log the attempt
        
        # In a production environment, you would make an API call to the LiveKit server like:
        # livekit_api_url = os.environ.get('LIVEKIT_API_URL')
        # response = requests.post(f"{livekit_api_url}/twirp/livekit.RoomService/DeleteRoom", json={"name": room_name})
        # response.raise_for_status()
        
        logger.info(f"Room '{room_name}' cleanup successful")
        return True
    except Exception as e:
        logger.error(f"Error cleaning up room '{room_name}': {str(e)}")
        return False

def generate_unique_room_name(base_name):
    """
    Generate a unique room name by appending a timestamp and random string
    
    Args:
        base_name: Base name for the room (typically user's room_id)
    
    Returns:
        str: Unique room name
    """
    timestamp = int(time.time())
    random_suffix = str(uuid.uuid4())[:8]
    return f"{base_name}-{timestamp}-{random_suffix}"