import os
from flask import Flask, render_template, redirect, url_for, flash, request, jsonify
from flask_login import LoginManager, current_user, login_required
from flask_wtf.csrf import CSRFProtect
from database import db, User
from routes.auth import auth_bp
from routes.admin import admin_bp
from routes.api import api_bp
from config import Config
from datetime import datetime

app = Flask(__name__)
app.config.from_object(Config)

# Initialize extensions
db.init_app(app)
csrf = CSRFProtect(app)
login_manager = LoginManager(app)
login_manager.login_view = 'auth.authenticate'

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp, url_prefix='/admin')
app.register_blueprint(api_bp, url_prefix='/api')

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('interact'))
    return redirect(url_for('auth.authenticate'))

# Template context processor for current year
@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

@app.route('/interact')
@login_required
def interact():
    return render_template('interact.html')

# Initialize database and create admin user
def init_db():
    # Create all tables based on models
    db.create_all()
    
    try:
        # Check if admin user exists
        admin = User.query.filter_by(username='admin').first()
        if not admin:
            from werkzeug.security import generate_password_hash
            admin = User(
                username='admin',
                password_hash=generate_password_hash('admin123'),  # Change this in production!
                is_admin=True,
                is_activated=True,
                room_id='admin-room'
            )
            db.session.add(admin)
            db.session.commit()
            print("Admin user created successfully")
    except Exception as e:
        # This will catch database schema mismatches
        print(f"Note: {e}")
        print("Run 'python reset_db.py' to reset the database with the new schema")

# Initialize database tables when app starts
with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(debug=True,host="0.0.0.0")