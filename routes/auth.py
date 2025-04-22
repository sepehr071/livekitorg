from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField
from wtforms.validators import DataRequired, Length, ValidationError
from database import db, User
from datetime import datetime

auth_bp = Blueprint('auth', __name__)

# Unified authentication form
class AuthForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired(), Length(min=3, max=80)])
    password = PasswordField('Password', validators=[DataRequired(), Length(min=6)])
    submit = SubmitField('Sign In')

@auth_bp.route('/auth', methods=['GET', 'POST'])
def authenticate():
    """
    Combined authentication route that handles both first-time login (registration)
    and regular login
    """
    if current_user.is_authenticated:
        return redirect(url_for('interact'))
    
    form = AuthForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        
        if user:
            # User exists - determine if this is first login or returning user
            if user.password_hash and user.is_activated:
                # Existing user - verify password
                if check_password_hash(user.password_hash, form.password.data):
                    # Set last login timestamp
                    user.last_login = datetime.utcnow()
                    db.session.commit()
                    
                    login_user(user)
                    next_page = request.args.get('next')
                    return redirect(next_page or url_for('interact'))
                else:
                    flash('Login failed. Please check your password.', 'danger')
            else:
                # First-time login - set password and activate account
                user.password_hash = generate_password_hash(form.password.data)
                user.is_activated = True
                user.last_login = datetime.utcnow()
                db.session.commit()
                
                login_user(user)
                flash('Your account has been activated! Welcome!', 'success')
                return redirect(url_for('interact'))
        else:
            # User doesn't exist
            flash('Username not found. Please contact an administrator to create an account.', 'danger')
    
    # Determine if this is a pre-created account that needs activation
    is_activation = False
    username = request.args.get('username', '')
    if username:
        user = User.query.filter_by(username=username).first()
        if user and not user.is_activated:
            is_activation = True
            form.username.data = username
    
    return render_template('auth.html', form=form, is_activation=is_activation)

# Redirect old login URL to new auth URL
@auth_bp.route('/login')
def login():
    return redirect(url_for('auth.authenticate'))

# Redirect old register URL to new auth URL
@auth_bp.route('/register')
def register():
    return redirect(url_for('auth.authenticate'))

@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))