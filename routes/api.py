from flask import Blueprint, jsonify, request, current_app
from flask_login import current_user, login_required
from database import db
import os
import traceback
from livekit_utils import generate_token, create_room, cleanup_room, generate_unique_room_name
import time
from datetime import datetime

api_bp = Blueprint('api', __name__)

@api_bp.route('/token', methods=['GET'])
@login_required
def get_token():
    """
    Generate a LiveKit token for the current logged-in user
    
    Returns:
        JSON with token and room information
    """
    # Check if this is a new connection request
    new_connection = request.args.get('newConnection', 'false').lower() == 'true'
    
    # Generate a unique room ID for this specific connection or use existing one
    if new_connection:
        # Get the language from the request, defaulting to English
        language = request.args.get('lang', 'en')
        
        # Use our enhanced unique room name generator
        room_name = generate_unique_room_name(f"room-{current_user.id}")
        current_app.logger.info(f"Creating new room for user {current_user.username}: {room_name} with language {language}")
        
        # If user already had a room, clean it up
        if current_user.room_id and current_user.room_id != room_name:
            old_room = current_user.room_id
            current_app.logger.info(f"Cleaning up previous room for user {current_user.username}: {old_room}")
            cleanup_room(old_room)
        
        # Update the user's room ID
        current_user.room_id = room_name
        db.session.commit()
    else:
        # Use the user's assigned room ID from the database
        room_name = current_user.room_id
        
        # Use default language if not specified
        language = request.args.get('lang', 'en')
        current_app.logger.info(f"Using existing room for user {current_user.username}: {room_name} with language {language}")
    
    # Ensure the room exists (LiveKit creates it if needed, but we could use admin API here)
    create_room(room_name)
    current_app.logger.debug(f"Room creation ensured for: {room_name}")
    
    try:
        # Generate token with the user's information
        # Get request parameters
        ttl_seconds = int(request.args.get('ttl', 3600))  # Default to 1 hour
        
        # Record performance metrics
        start_time = time.time()
        
        current_app.logger.debug(f"Generating token for user {current_user.username} in room {room_name}")
        token = generate_token(
            room_name=room_name,
            participant_name=current_user.username,
            ttl_seconds=ttl_seconds
        )
        
        elapsed_time = time.time() - start_time
        current_app.logger.debug(f"Token generated in {elapsed_time:.3f}s")
        current_app.logger.debug(f"Token generated successfully for {current_user.username}")
        
        livekit_url = os.environ.get('LIVEKIT_URL', '')
        
        # Check that URL is properly formatted (must start with wss:// or ws://)
        if not livekit_url.startswith('wss://') and not livekit_url.startswith('ws://'):
            current_app.logger.warning(f"LiveKit URL format may be invalid: {livekit_url}")
        
        # Get language parameter if provided
        language = request.args.get('lang', 'en')
        
        response_data = {
            'success': True,
            'token': token,
            'room': room_name,
            'username': current_user.username,
            'livekit_url': livekit_url,
            'new_connection': new_connection,
            'language': language,
            'expires_in': ttl_seconds,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        current_app.logger.info(f"Token request successful: room={room_name}, new_connection={new_connection}")
        return jsonify(response_data)
    
    except Exception as e:
        error_traceback = traceback.format_exc()
        current_app.logger.error(f"Token generation failed: {str(e)}\n{error_traceback}")
        
        return jsonify({
            'success': False,
            'error': str(e),
            'details': error_traceback
        }), 500

@api_bp.route('/heartbeat', methods=['POST'])
@login_required
def heartbeat():
    """
    Simple heartbeat endpoint to maintain session activity
    
    Returns:
        JSON confirmation
    """
    try:
        # Get room info from request if provided
        data = request.json or {}
        room_name = data.get('roomName', current_user.room_id)
        
        # Log the heartbeat with more information
        current_app.logger.debug(f"Heartbeat received from {current_user.username} in room {room_name}")
        
        return jsonify({
            'success': True,
            'timestamp': datetime.utcnow().isoformat(),
            'user': current_user.username,
            'room': room_name
        })
    except Exception as e:
        current_app.logger.error(f"Error processing heartbeat: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api_bp.route('/disconnect', methods=['POST'])
@login_required
def disconnect():
    """
    Record user disconnect (optional, could be used for analytics)
    
    Returns:
        JSON confirmation
    """
    try:
        # Get additional data from request
        data = request.json or {}
        room_name = data.get('roomName', current_user.room_id)
        disconnect_reason = data.get('reason', 'user_initiated')
        
        # Log the disconnect event for monitoring and analytics
        current_app.logger.info(f"User {current_user.username} disconnected from room {room_name}. Reason: {disconnect_reason}")
        
        # Here you could record the disconnect event in a database if needed
        # For example, tracking session durations, disconnect reasons, etc.
        
        return jsonify({
            'success': True,
            'message': 'Disconnect recorded',
            'user': current_user.username,
            'room': room_name,
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        current_app.logger.error(f"Error recording disconnect: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500