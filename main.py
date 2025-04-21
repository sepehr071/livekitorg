from dotenv import load_dotenv
import logging
import re
import ssl
import smtplib
import asyncio
import os
import httpx
from typing import AsyncIterable, Optional, Dict, Any, Type, List
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from openai import OpenAI

from livekit import rtc
from livekit.agents import (
    JobContext, WorkerOptions, cli, APIConnectOptions, function_tool, RunContext,
    AudioConfig, BackgroundAudioPlayer, BuiltinAudioClip
)
from livekit.agents.voice import Agent, AgentSession
from dataclasses import dataclass, field
from livekit.plugins import (
    openai,
    deepgram,
    silero
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel

# Import utils or define utility functions if needed
try:
    from utils import load_prompt, load_product_info
except ImportError:
    # Define utility functions directly if module is not available
    import yaml
    import os
    
    def load_prompt(prompt_file):
        """Load a prompt from a YAML file or return default if file not found."""
        try:
            with open(f"prompts/{prompt_file}", "r", encoding="utf-8") as file:
                return yaml.safe_load(file)
        except (FileNotFoundError, yaml.YAMLError) as e:
            logging.error(f"Error loading prompt from {prompt_file}: {e}")
            # Return a default prompt if file cannot be loaded
            if "general" in prompt_file:
                return "You are Caila, a helpful sales assistant for ruggedized mobile devices."
            elif "product" in prompt_file:
                return "You are Caila, a product specialist for ruggedized mobile devices."
            return "You are Caila, a helpful assistant."
    
    def load_product_info():
        """Load the product information from the markdown file."""
        try:
            # First try to load from final.md (as in testtt.py)
            if os.path.exists("final.md"):
                logging.info("Loading product information from final.md")
                with open("final.md", "r", encoding="utf-8") as file:
                    return file.read()
            
            # Fall back to product-info.md if final.md doesn't exist
            logging.info("Loading product information from product-info.md")
            with open("product-info.md", "r", encoding="utf-8") as file:
                return file.read()
        except Exception as e:
            logging.error(f"Error loading product information: {e}")
            return "Product information not available."

# Setup logging
logger = logging.getLogger("dual-agent")
logger.setLevel(logging.DEBUG)

# Load environment variables
load_dotenv()

@dataclass
class UserData:
    """Stores data to be shared across the session"""
    agents: Dict[str, Agent] = field(default_factory=dict)
    previous_agent: Optional[Agent] = None
    last_query: str = ""
    email_address: Optional[str] = None
    last_transfer_time: float = 0.0  # Timestamp of last transfer between agents
    cooldown_period: float = 5.0     # Seconds to wait before allowing another transfer
    initial_greeting_shown: bool = False  # Track if initial greeting has been shown
    
    def summarize(self) -> str:
        """Summarize user data for context passing."""
        return f"Last query: {self.last_query}" + \
               (f", Email: {self.email_address}" if self.email_address else "")
               
    def can_transfer(self, current_time: float) -> bool:
        """Check if enough time has passed since the last transfer."""
        return (current_time - self.last_transfer_time) >= self.cooldown_period
    
    def update_transfer_time(self, current_time: float) -> None:
        """Update the last transfer timestamp."""
        self.last_transfer_time = current_time


class BaseAgent(Agent):
    """Base agent class with common functionality for all agents."""
    
    async def on_enter(self) -> None:
        """Handler called when the agent becomes active."""
        agent_name = self.__class__.__name__
        logger.info(f"Entering {agent_name}")
        
        userdata = self.session.userdata
        chat_ctx = self.chat_ctx.copy()
        
        # Transfer context from previous agent if there was one
        if userdata.previous_agent:
            items_copy = self._truncate_chat_ctx(
                userdata.previous_agent.chat_ctx.items,
                keep_function_call=True
            )
            
            existing_ids = {item.id for item in chat_ctx.items}
            items_copy = [item for item in items_copy if item.id not in existing_ids]
            chat_ctx.items.extend(items_copy)
        
        # Add a system message for context
        chat_ctx.add_message(
            role="system",
            content=f"You are Caila. {userdata.summarize()}"
        )
        
        await self.update_chat_ctx(chat_ctx)
    
    def _truncate_chat_ctx(
        self,
        items: list,
        keep_last_n_messages: int = 6,
        keep_system_message: bool = False,
        keep_function_call: bool = False,
    ) -> list:
        """Truncate the chat context to keep the last n messages."""
        def _valid_item(item) -> bool:
            if not keep_system_message and item.type == "message" and item.role == "system":
                return False
            if not keep_function_call and item.type in ["function_call", "function_call_output"]:
                return False
            return True
        
        new_items = []
        for item in reversed(items):
            if _valid_item(item):
                new_items.append(item)
            if len(new_items) >= keep_last_n_messages:
                break
        new_items = new_items[::-1]
        
        # Clean up any function calls at the beginning that might be incomplete
        while new_items and new_items[0].type in ["function_call", "function_call_output"]:
            new_items.pop(0)
        
        return new_items
    
    async def _transfer_to_agent(self, name: str, context: RunContext[UserData]) -> Agent:
        """Transfer to another agent while preserving context."""
        userdata = context.userdata
        current_agent = context.session.current_agent
        next_agent = userdata.agents[name]
        userdata.previous_agent = current_agent
        
        return next_agent


# Email helper functions - kept from original implementation
def is_valid_email(email: str) -> bool:
    """Validate email format using a simple regex pattern."""
    if not email:
        return False
        
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def format_chat_history(history_dict: Dict) -> str:
    """Format the chat history into a readable text format."""
    formatted_text = "CONVERSATION HISTORY\n\n"
    
    # Check for the LiveKit 1.0 "items" format
    if history_dict and "items" in history_dict:
        logger.info(f"Formatting chat history with {len(history_dict['items'])} items")
        
        # Format each message in the items array
        for i, item in enumerate(history_dict.get("items", [])):
            # Only process message items
            if item.get("type") != "message":
                continue
                
            role = item.get("role", "unknown").upper()
            
            # Handle content as either string or array
            content_value = item.get("content", [])
            if isinstance(content_value, list):
                content = " ".join(str(c) for c in content_value)
            else:
                content = str(content_value)
            
            # Add separator between messages for readability
            if i > 0:
                formatted_text += "-" * 40 + "\n"
                
            formatted_text += f"{role}: {content}\n\n"
        
        return formatted_text
    
    # Check for the old "messages" format as fallback
    elif history_dict and "messages" in history_dict:
        logger.info(f"Formatting chat history with {len(history_dict['messages'])} messages")
        
        # Format each message in the messages array
        for i, message in enumerate(history_dict.get("messages", [])):
            role = message.get("role", "unknown").upper()
            
            # Handle content as either string or array
            content_value = message.get("content", "")
            if isinstance(content_value, list):
                content = " ".join(str(c) for c in content_value)
            else:
                content = str(content_value)
            
            # Add separator between messages for readability
            if i > 0:
                formatted_text += "-" * 40 + "\n"
                
            formatted_text += f"{role}: {content}\n\n"
        
        return formatted_text
    
    # No recognized format
    logger.warning(f"No recognized history format found in: {list(history_dict.keys()) if history_dict else 'None'}")
    return formatted_text + "No conversation history available in a recognized format."


def send_email(receiver_email: str, subject: str, body: str) -> bool:
    """Send an email using SMTP server with security."""
    # 1. Email validation
    if not is_valid_email(receiver_email):
        logger.error(f"Invalid email format: {receiver_email}")
        return False
        
    # 2. Get credentials from environment variables
    sender_email = os.environ.get("EMAIL_SENDER")
    sender_password = os.environ.get("EMAIL_PASSWORD")
    sender_name = os.environ.get("EMAIL_SENDER_NAME", "Caila - Technology Consultant")
    
    # Validate email configuration
    if not sender_email or not sender_password:
        logger.error("Email configuration missing - please set EMAIL_SENDER and EMAIL_PASSWORD in .env")
        return False
    
    try:
        # Create a multipart message
        message = MIMEMultipart()
        message["From"] = f"{sender_name} <{sender_email}>"
        message["To"] = receiver_email
        message["Subject"] = subject
        
        # Add body to email
        message.attach(MIMEText(body, "plain"))
        
        logger.info(f"Connecting to SMTP server to send email...")
        
        # Create secure context
        context = ssl.create_default_context()
        
        # Create SMTP session
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            # Start TLS with security
            server.starttls(context=context)
            
            # Authentication
            server.login(sender_email, sender_password)
            
            # Send the email
            server.sendmail(sender_email, receiver_email, message.as_string())
            
            logger.info(f"Email sent successfully!")
            return True
            
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        return False


async def generate_conversation_summary(history_dict: Dict) -> str:
    """Generate a semantic summary of the conversation history using OpenAI."""
    try:
        # Format the history for the LLM
        formatted_history = format_chat_history(history_dict)
        
        # Get the API key from environment
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY is not set in environment variables")
            return "Unable to generate a summary: API key not configured."
        
        # Create an OpenAI client
        client = OpenAI()
        
        try:
            # Since this is a synchronous API in an async context,
            # run it in a separate thread to avoid blocking
            loop = asyncio.get_event_loop()
            
            # Create the prompt for summarization
            prompt = (
                "Extract only factual information about products, devices, and technical specifications from this conversation. "
                "Focus on factual content only, including product details, features, specifications, and use cases. "
                "DO NOT mention 'user said', 'assistant replied', or reference the conversation itself in any way. "
                "Your summary should:\n\n"
                "1. Present information as direct, objective statements organized by topic\n"
                "2. Focus primarily on device specifications, features, and business benefits\n"
                "3. Use bullet points for clear organization of product details\n"
                "4. Include only substantive technical and product information\n"
                "5. Omit all conversational elements, questions, and non-product information\n\n"
                f"CONVERSATION:\n{formatted_history}\n\n"
                "PRODUCT INFORMATION SUMMARY:"
            )
            
            response = await loop.run_in_executor(
                None,
                lambda: client.chat.completions.create(
                    model="gpt-4.1-nano-2025-04-14",
                    messages=[
                        {"role": "system", "content": "You are a product information specialist who extracts factual device specifications and features. Your summaries are concise, factual, and focused only on product details, without mentioning the conversation itself."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2000
                )
            )
            
            # Extract the summary from the response
            if response.choices and len(response.choices) > 0:
                summary = response.choices[0].message.content
                return summary.strip()
            else:
                logger.error("Empty response from OpenAI API")
                return "Unable to generate a summary: empty response from API."
        except Exception as api_error:
            logger.error(f"Error calling OpenAI API: {api_error}")
            return "Unable to generate a summary: error calling the AI service."
            
    except Exception as e:
        logger.error(f"Error generating conversation summary: {e}")
        return "Unable to generate a summary of our conversation due to a technical error."


class GeneralAgent(BaseAgent):
    """General assistant for handling initial customer inquiries."""
    
    def __init__(self, api_options: Optional[APIConnectOptions] = None) -> None:
        # Configure optimized VAD parameters for better interruption handling
        vad_config = silero.VAD.load(
            min_speech_duration=0.05,      # Default: 0.05 - Minimum duration to detect speech
            min_silence_duration=0.40,     # Default: 0.55 - Reduced for faster response
            prefix_padding_duration=0.2,   # Default: 0.5 - Reduced padding for tighter turns
            activation_threshold=0.7,      # Default: 0.5 - More sensitive to detect speech
            max_buffered_speech=30.0       # Default: 60.0 - Reduced buffer size
        )
        
        # Configure timeout directly from api_options if provided
        timeout_value = None
        if api_options:
            import httpx
            timeout_value = httpx.Timeout(api_options.timeout)
            logger.info(f"Using timeout of {api_options.timeout}s for GeneralAgent")
        
        super().__init__(
            instructions=load_prompt('general_prompt.yaml'),
            stt=deepgram.STT(model="nova-3-general", language="multi",smart_format=True),
            llm=openai.LLM(
                model="gpt-4.1-nano-2025-04-14",
                temperature=0.5,
                timeout=timeout_value
            ),
            tts=openai.TTS(model="gpt-4o-mini-tts", voice="alloy",instructions="high energy woman with strong german language and accent",speed=0.9),
            vad=vad_config
        )
    
    async def on_enter(self):
        """Handler called when the agent becomes active."""
        await super().on_enter()
        
        # Only show the greeting if this is not a transfer or if it's the first time
        userdata = self.session.userdata
        if not userdata.previous_agent or not userdata.initial_greeting_shown:
            logger.info("GeneralAgent started, providing initial greeting")
            await self.session.generate_reply(
                instructions="Greet the user warmly and introduce yourself as Caila, a persuasive sales professional dedicated to promoting and selling ruggedized mobile data entry devices, handheld computers, and barcode scanners"
            )
            userdata.initial_greeting_shown = True
        else:
            # This is a transfer back from product agent, continue the conversation
            logger.info("GeneralAgent continuing after transfer")
            await self.session.generate_reply(
                instructions=f"Continue the conversation naturally without reintroducing yourself. Address the user's query: '{userdata.last_query}'. Do not mention any transfer or switching - maintain the illusion of a single, continuous conversation."
            )
    
    @function_tool()
    async def transfer_to_product_agent(self, context: RunContext[UserData], query: str) -> Agent:
        """
        Transfer to the product agent for specific product questions.
        
        Args:
            query: The user's product-specific query that needs detailed information
        """
        import time
        current_time = time.time()
        userdata = context.userdata
        
        # Check if this is a transfer that should be avoided (too quick after previous transfer)
        if not userdata.can_transfer(current_time):
            logger.info(f"Preventing transfer to product agent (cooldown): {query}")
            await self.session.generate_reply(
                instructions=f"The user asked: '{query}'. This appears to be a product-specific question, but we just transferred between agents. Answer this generally without specific product details. Do NOT mention any transfer cooldown or switching - maintain the illusion of a single, continuous conversation."
            )
            return self  # Return self to avoid transfer
        
        # Comprehensive list of general keywords that should prevent transfer
        general_keywords = [
            "help", "assistance", "talk", "connect", "general", "question", "inquiry",
            "hello", "hi", "greetings", "good morning", "good afternoon",
            "thank", "appreciate", "goodbye", "bye", "talk later"
        ]
        
        # Check if this is an ambiguous query that should be handled by general agent
        if any(keyword in query.lower() for keyword in general_keywords) and not any(word in query.lower()
            for word in ["device", "model", "battery", "scanner", "product", "spec", "feature"]):
            logger.info(f"Preventing transfer for general query: {query}")
            await self.session.generate_reply(
                instructions=f"The user asked: '{query}'. This appears to be a general question. Answer this without transferring to the product agent. Do NOT mention anything about agents or transfers."
            )
            return self  # Return self to avoid transfer
        
        # Detect product-specific queries
        product_phrases = [
            "device", "model", "battery", "scanner", "barcode", "rugged", "spec",
            "specification", "feature", "product", "mobile", "handheld", "memory",
            "storage", "camera", "screen", "display", "processor", "comparison",
            "dimension", "weight", "price", "cost", "warranty", "support",
            "how much", "which one", "tell me about", "what kind", "what type",
            "scanner", "zebra", "honeywell", "datalogic", "point mobile", "urovo"
        ]
        
        # Calculate product query score
        product_score = sum(1 for phrase in product_phrases if phrase in query.lower())
        is_strong_product_query = product_score >= 1
        
        # Only transfer for product queries
        if not is_strong_product_query:
            logger.info(f"Preventing transfer for non-product query: {query}")
            await self.session.generate_reply(
                instructions=f"The user asked: '{query}'. This doesn't appear to be a specific product question. Answer this without transferring to the product agent. Do NOT mention anything about agents or transfers."
            )
            return self  # Return self to avoid transfer
            
        logger.info(f"Transferring to product agent for: {query}")
        
        # Tell the user we're looking for product info in a conversational way
        await self.session.say("Let me check our product database for that information.")
        
        # Store the query in userdata for context
        userdata.last_query = query
        
        # Update transfer time
        userdata.update_transfer_time(current_time)
        
        # Play transition sound if background audio is available
        if 'background_audio' in globals() and background_audio:
            background_audio.play("transition.wav")
        
        # Return the product agent to trigger handoff
        return await self._transfer_to_agent("product", context)
    
    @function_tool()
    async def send_email_to_user(
        self,
        context: RunContext[UserData],
        receiver_email: str,
        send_summary: bool
    ) -> Dict[str, Any]:
        """
        Send the conversation history to the user via email.
        
        Args:
            receiver_email: The email address to send the conversation history to
            send_summary: Whether to send a summary (True) or the full transcript (False)
        """
        # Add the confirmation message immediately
        await self.session.say("I will send the email and tell you when I'm done.")
        
        logger.info(f"Caila sending {'summary' if send_summary else 'transcript'} to: {receiver_email}")
        
        try:
            # Store email address for future use
            context.userdata.email_address = receiver_email
            
            # Get chat history from the session
            history_dict = {}
            if hasattr(context.session, 'history') and context.session.history:
                history_dict = context.session.history.to_dict()
            elif hasattr(context.session, 'chat_ctx') and context.session.chat_ctx:
                # Convert chat context to history dict format
                messages = context.session.chat_ctx.messages if hasattr(context.session.chat_ctx, 'messages') else []
                history_dict = {"items": [
                    {"type": "message", "role": msg.get("role"), "content": msg.get("content")}
                    for msg in messages
                ]}
            
            # Generate content based on preference
            if send_summary:
                content = await generate_conversation_summary(history_dict)
                subject = "Summary of Your Conversation with Caila"
                intro = "Here's a summary of your conversation with Caila, your tech consultant:"
            else:
                content = format_chat_history(history_dict)
                subject = "Your Conversation with Caila"
                intro = "Here's the transcript of your conversation with Caila, your tech consultant:"
            
            # Format email
            body = f"Hello,\n\n{intro}\n\n{content}\n\nBest regards,\nCaila - Your Technology Consultant"
            
            # Send email
            success = send_email(receiver_email, subject, body)
            
            if success:
                return {
                    "status": "success",
                    "message": f"Email with {'summary' if send_summary else 'transcript'} sent to {receiver_email}"
                }
            else:
                return {
                    "status": "error",
                    "message": f"Failed to send email to {receiver_email}"
                }
        except Exception as e:
            logger.error(f"Error sending email: {e}")
            return {
                "status": "error",
                "message": f"Error: {str(e)}"
            }


class ProductAgent(BaseAgent):
    """Product specialist for answering specific product questions."""
    
    def __init__(self, api_options: Optional[APIConnectOptions] = None) -> None:
        # Load product information
        product_info = load_product_info()
        
        # Create combined prompt for the product agent
        product_prompt = load_prompt('product_prompt.yaml')
        combined_prompt = f"{product_prompt}\n\nYou have access to the following product information:\n\n{product_info}"
        
        # Configure optimized VAD parameters
        vad_config = silero.VAD.load(
            min_speech_duration=0.05,      # Default: 0.05 - Minimum duration to detect speech
            min_silence_duration=0.40,     # Default: 0.55 - Even faster response for product needs
            prefix_padding_duration=0.25,  # Default: 0.5 - Less padding for quick interruptions
            activation_threshold=0.40,     # Default: 0.5 - More sensitive to detect soft speech
            max_buffered_speech=20.0       # Default: 60.0 - Smaller buffer for faster processing
        )
        
        # Configure timeout directly from api_options if provided
        timeout_value = None
        if api_options:
            import httpx
            timeout_value = httpx.Timeout(api_options.timeout)
            logger.info(f"Using timeout of {api_options.timeout}s for ProductAgent")
        
        super().__init__(
            instructions=combined_prompt,
            stt=deepgram.STT(model="nova-3-general", language="multi",smart_format=True),
            llm=openai.LLM(
                model="gpt-4.1-mini-2025-04-14",
                temperature=0.2,
                timeout=timeout_value
            ),
            tts=openai.TTS(model="gpt-4o-mini-tts", voice="alloy",instructions="informatic tone , slow talking , energyfull",speed=0.85),
            vad=vad_config
        )
    
    async def on_enter(self):
        """Answer the product question directly without introduction."""
        await super().on_enter()
        logger.info("ProductAgent processing query")
        
        # Get the last query if available
        userdata = self.session.userdata
        last_query = userdata.last_query
        
        if last_query:
            # Check if this is an explicit transfer request that was missed
            # More comprehensive list of possible transfer phrases
            transfer_phrases = [
                "talk to general", "connect with general", "switch to general", "general agent",
                "connect general", "back to general", "change agent", "talk to someone else",
                "connect with your general agent", "switch agents", "go back"
            ]
            
            # More aggressive matching - match partial phrases too
            if any(phrase in last_query.lower() for phrase in transfer_phrases):
                # This should have been transferred but was missed, let's handle it
                import time
                current_time = time.time()
                if userdata.can_transfer(current_time):
                    logger.info(f"Detected missed transfer request in on_enter: {last_query}")
                    userdata.update_transfer_time(current_time)
                    await self.transfer_to_general_agent(RunContext(self.session, userdata), "Transfer back to general")
                    return
            
            # Normal product question handling
            await self.session.generate_reply(
                instructions=f"""Answer this product question directly without introducing yourself: '{last_query}'.
                ONLY use information from the final.md file provided in your system prompt. Do not use any other knowledge.
                
                If the specific information isn't in final.md, respond with something like:
                "I don't have that specific information in our product database, but I'd be happy to tell you about [related topic you do have info about]."
                
                Or if nothing related is available:
                "I don't have that specific information available. Is there something else about our ruggedized devices you'd like to know?"
                
                Keep your answer concise (2-3 sentences) to make sure the user can interrupt if needed, but include relevant product details when available."""
            )
        else:
            await self.session.generate_reply(
                instructions="""Continue the conversation naturally as Caila, keeping your response very brief (1-2 sentences).
                Ask what specific product information they'd like to know about our ruggedized devices.
                Remember to ONLY use information from the final.md file provided and be upfront when you don't have specific information."""
            )
    
    @function_tool()
    async def transfer_to_general_agent(self, context: RunContext[UserData], query: str) -> Agent:
        """
        Return to general conversation when the user asks non-product related questions.
        
        Args:
            query: The user's non-product specific query
        """
        import time
        current_time = time.time()
        userdata = context.userdata
        
        # Check if this is a transfer that should be avoided (too quick after previous transfer)
        if not userdata.can_transfer(current_time):
            logger.info(f"Preventing transfer to general agent (cooldown): {query}")
            await self.session.generate_reply(
                instructions=f"The user asked: '{query}'. This appears to be a general question, but we just transferred between agents. Try to answer this generally while staying in your role. Do NOT mention any transfer cooldown or switching - maintain the illusion of a single, continuous conversation."
            )
            return self  # Return self to avoid transfer
            
        # Detect explicit transfer requests - more comprehensive list
        transfer_phrases = [
            "talk to general", "connect with general", "switch to general",
            "speak with general", "talk to the general", "connect to general",
            "change agent", "talk to someone else", "get general help",
            "go back", "back to previous", "return to general", "general agent",
            "talk to ana", "speak to ana", "change back", "switch back"
        ]
        
        # Calculate transfer request score
        transfer_words = ["talk", "connect", "switch", "speak", "change", "general", "back", "return"]
        transfer_score = sum(1 for word in transfer_words if word in query.lower().split())
        
        # Check if this is a direct request to transfer - either exact phrase or many keywords
        is_transfer_request = any(phrase in query.lower() for phrase in transfer_phrases) or transfer_score >= 2
        
        # Identify general business questions that aren't product specific - expanded list
        general_indicators = [
            "business", "company", "industry", "help", "support",
            "service", "contact", "question", "general", "inquiry",
            "thank", "appreciate", "goodbye", "bye", "talk later",
            "advice", "suggestion", "recommendation", "idea",
            "hello", "hi", "greetings", "good morning", "good afternoon",
            "pricing", "payment", "discount", "deal", "offer", "availability",
            "delivery", "shipping", "order", "purchase", "buy",
            "warranty", "guarantee", "return policy", "refund"
        ]
        
        is_general_query = any(indicator in query.lower() for indicator in general_indicators)
        
        if is_transfer_request or is_general_query:
            logger.info(f"Transferring to general agent for: {query}")
            
            # Tell the user we're returning to general conversation naturally
            await self.session.say("I understand what you're asking about.")
            
            # Store the query in userdata for context
            userdata.last_query = query
            
            # Update transfer time
            userdata.update_transfer_time(current_time)
            
            # Play transition sound if background audio is available
            if 'background_audio' in globals() and background_audio:
                background_audio.play("transition.wav")
            
            # Return the general agent to trigger handoff
            return await self._transfer_to_agent("general", context)
        else:
            # Not a general query, handle it as a product query
            logger.info(f"Handling as product query (not transferring): {query}")
            await self.session.generate_reply(
                instructions=f"The user asked: '{query}'. This appears to be a product-related question. Answer using ONLY information from the final.md file. If you don't have the specific information, politely say 'I don't have that specific information in our product database.'"
            )
            return self  # Return self to avoid transfer
    
    @function_tool()
    async def send_email_to_user(
        self,
        context: RunContext[UserData],
        receiver_email: str,
        send_summary: bool
    ) -> Dict[str, Any]:
        """
        Send the conversation history to the user via email.
        
        Args:
            receiver_email: The email address to send the conversation history to
            send_summary: Whether to send a summary (True) or the full transcript (False)
        """
        # Add the confirmation message immediately
        await self.session.say("I will send the email and tell you when I'm done.")
        
        logger.info(f"Caila sending {'summary' if send_summary else 'transcript'} to: {receiver_email}")
        
        try:
            # Store email address for future use
            context.userdata.email_address = receiver_email
            
            # Get chat history from the session
            history_dict = {}
            if hasattr(context.session, 'history') and context.session.history:
                history_dict = context.session.history.to_dict()
            elif hasattr(context.session, 'chat_ctx') and context.session.chat_ctx:
                # Convert chat context to history dict format
                messages = context.session.chat_ctx.messages if hasattr(context.session.chat_ctx, 'messages') else []
                history_dict = {"items": [
                    {"type": "message", "role": msg.get("role"), "content": msg.get("content")}
                    for msg in messages
                ]}
            
            # Generate content based on preference
            if send_summary:
                content = await generate_conversation_summary(history_dict)
                subject = "Summary of Your Conversation with Caila"
                intro = "Here's a summary of your conversation with Caila:"
            else:
                content = format_chat_history(history_dict)
                subject = "Your Conversation with Caila"
                intro = "Here's the transcript of your conversation with Caila:"
            
            # Format email
            body = f"Hello,\n\n{intro}\n\n{content}\n\nBest regards,\nCaila - Your Technology Consultant"
            
            # Send email
            success = send_email(receiver_email, subject, body)
            
            if success:
                return {
                    "status": "success",
                    "message": f"Email with {'summary' if send_summary else 'transcript'} sent to {receiver_email}"
                }
            else:
                return {
                    "status": "error",
                    "message": f"Failed to send email to {receiver_email}"
                }
        except Exception as e:
            logger.error(f"Error sending email: {e}")
            return {
                "status": "error",
                "message": f"Error: {str(e)}"
            }


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    logger.info("Starting dual-agent system...")
    
    # Configure API connection options
    api_options = APIConnectOptions(
        max_retry=5,          # Increase retries
        retry_interval=1.0,   # Interval between retries (increased from 0.2s)
        timeout=60.0          # Timeout for API calls
    )
    
    # Create both agents with API options
    general_agent = GeneralAgent(api_options=api_options)
    product_agent = ProductAgent(api_options=api_options)
    
    # Initialize user data with agent references
    userdata = UserData()
    userdata.agents = {
        "general": general_agent,
        "product": product_agent
    }
    userdata.cooldown_period = 10.0  # Longer cooldown to prevent frequent switching (10 seconds)
    
    # Create session with userdata and turn detection configuration
    session = AgentSession[UserData](
        userdata=userdata,
        turn_detection=MultilingualModel(),
        allow_interruptions=True,
        min_interruption_duration=0.3,
        min_endpointing_delay=0.4,
        max_endpointing_delay=3.0
    )
    
    logger.info(f"API options configured with timeout of {api_options.timeout}s")
    logger.info(f"Agent transfer cooldown period set to {userdata.cooldown_period}s")
    
    # Create a global reference to store the BackgroundAudioPlayer
    global background_audio
    background_audio = None
    
    # Setup background audio player for transition sounds
    bg_player = BackgroundAudioPlayer(
        ambient_sound=None,
        thinking_sound=None
    )
    
    # Store the player in our global variable for use by the agents
    background_audio = bg_player
    
    # Add transcript detection for automatic agent switching if needed
    @session.on("transcript")
    def on_transcript(transcript):
        # Use asyncio.create_task to run the async processing
        import asyncio
        asyncio.create_task(process_transcript(transcript))
    
    # Define transcript processor for additional agent switching logic
    async def process_transcript(transcript):
        try:
            query = transcript.text
            if not query or len(query.strip()) == 0:
                return
            
            current_agent_name = "general" if isinstance(session.current_agent, GeneralAgent) else "product"
            logger.debug(f"Processing transcript with {current_agent_name} agent: {query}")
            
            # Only analyze for transfers if we're not responding yet and if outside cooldown period
            import time
            current_time = time.time()
            if not userdata.can_transfer(current_time):
                logger.debug(f"Skipping transfer analysis (in cooldown period): {query}")
                return
                
            # Check for explicit transfer requests
            transfer_phrases = [
                "talk to general", "connect with general", "switch to general",
                "general agent", "back to general"
            ]
            
            # Detect transfer requests first
            if any(phrase in query.lower() for phrase in transfer_phrases) and current_agent_name == "product":
                logger.info(f"Detected explicit transfer request in transcript handler: {query}")
                # Let the agent handle this with its function tool in on_enter
                userdata.last_query = query
            
        except Exception as e:
            logger.error(f"Error processing transcript: {e}")
    
    # Log function calls for debugging
    @session.on("function_call")
    def on_function_call(event):
        logger.info(f"Function call detected: {event.name} with args: {event.arguments}")
    
    # Start with the general assistant
    await session.start(
        agent=general_agent,
        room=ctx.room
    )
    
    # Start background audio player
    await background_audio.start(room=ctx.room, agent_session=session)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))