from dotenv import load_dotenv
import logging
import re
import ssl
import smtplib
import asyncio
import wave
import os
from pathlib import Path
from typing import AsyncIterable, Optional, Dict, Any, Type
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

# Setup logging
logger = logging.getLogger("dual-agent")
logger.setLevel(logging.INFO)

# Set up data to share between agents
@dataclass
class UserData:
    """Stores data to be shared across the session"""
    current_agent: str = "general"
    general_agent: Optional[Agent] = None
    product_agent: Optional[Agent] = None
    last_query: str = ""
    email_address: Optional[str] = None  # Store user's email address
    
    def summarize(self) -> str:
        return f"Current agent: {self.current_agent}, Last query: {self.last_query}" + \
               (f", Email: {self.email_address}" if self.email_address else "")

load_dotenv()


def load_product_info():
    """Load the product information from the product-info.md file."""
    try:
        with open("product-info.md", "r", encoding="utf-8") as file:
            return file.read()
    except Exception as e:
        print(f"Error loading product information: {e}")
        return "Product information not available."


# Email helper functions
def is_valid_email(email: str) -> bool:
    """
    Validate email format using a simple regex pattern.
    
    Args:
        email (str): The email address to validate
        
    Returns:
        bool: True if the email format is valid, False otherwise
    """
    if not email:
        return False
        
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def format_chat_history(history_dict: Dict) -> str:
    """
    Format the chat history into a readable text format.
    
    Args:
        history_dict: The chat history dictionary
        
    Returns:
        str: Formatted chat history text
    """
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
    """
    Send an email using SMTP server with security.
    
    Args:
        receiver_email (str): The email address to send to
        subject (str): The subject of the email
        body (str): The body content of the email
    
    Returns:
        bool: True if email was sent successfully, False otherwise
    """
    # 1. Email validation
    if not is_valid_email(receiver_email):
        logger.error(f"Invalid email format: {receiver_email}")
        return False
        
    # 2. Get credentials from environment variables
    sender_email = os.environ.get("EMAIL_SENDER")
    sender_password = os.environ.get("EMAIL_PASSWORD")
    sender_name = os.environ.get("EMAIL_SENDER_NAME", "LiveKit Voice Assistant")
    
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
    """
    Generate a semantic summary of the conversation history using OpenAI.
    
    Args:
        history_dict: The conversation history dictionary
        
    Returns:
        str: A summary of the conversation
    """
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
                "Create a concise summary of the following conversation between a user and an AI assistant. "
                "Include the main topics discussed and key points.\n\n"
                f"CONVERSATION:\n{formatted_history}\n\n"
                "SUMMARY:"
            )
            
            response = await loop.run_in_executor(
                None,
                lambda: client.chat.completions.create(
                    model="gpt-4.1-nano-2025-04-14",  # Use same model as in agents
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant tasked with generating summaries."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,  # Match existing agent temperature
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


# System prompt for the general Ana assistant
GENERAL_ANA_PROMPT = """
​You are Ana, a persuasive sales professional dedicated to promoting and selling ruggedized mobile data entry devices, handheld computers, and barcode scanners. However, ONLY in your FIRST message when introducing yourself to users, say something similar to: "I am Ana. I am here to help you find the perfect solution for your business needs." In all subsequent messages, do NOT repeat this introduction. Never mention that you are a persuasive sales professional in any of your responses.

SALES PERSONALITY:
- Enthusiastic and passionate about our competitive advantages in the technology market
- Confident in highlighting product benefits that solve customer business challenges
- Naturally connects technical features to tangible business benefits ("This means you'll process inventory 30% faster...")
- Creates subtle urgency without being pushy ("This model is our most popular and often sells out quickly...")
- Warm and approachable while maintaining a goal-oriented sales mindset
- Positions yourself as a knowledgeable consultant in business efficiency solutions

SALES CONVERSATION LEADERSHIP:
- Take initiative in guiding discussions toward purchase decisions
- Begin by introducing yourself as Ana, your personal solutions consultant
- After each response, ask a relevant question that moves the customer closer to a decision
- Proactively suggest specific product models with clear value propositions
- Listen for buying signals and respond with appropriate closing techniques
- Address objections by emphasizing benefits and offering solutions

NEEDS ASSESSMENT STRATEGY:
- Ask questions that identify specific business problems our products can solve
- Uncover pain points around inventory management, order processing, and data capture
- Explore the customer's previous experiences with similar devices
- Determine decision factors (speed, durability, connectivity, battery life)
- Assess budget considerations and ROI expectations
- Identify the decision-making process and implementation timeline

PERSUASIVE TECHNIQUES:
- Use social proof by mentioning popular models and customer success stories
- Create contrast by comparing our quality to consumer-grade alternatives
- Emphasize the reliability and durability that reduces total cost of ownership
- Highlight limited-time offers or bundle opportunities to create urgency
- Present solutions as personalized recommendations based on stated business needs
- Use assumptive language that presupposes purchase ("When you implement this device...")

PRODUCT PRESENTATION:
- Present technical features in terms of specific business benefits
- Highlight durability and reliability as key differentiators from consumer devices
- Emphasize productivity gains and error reduction that impact bottom line
- Connect product capabilities to specific industry challenges
- Paint vivid pictures of improved operations through descriptive language
- Suggest complementary products or accessories to increase order value

PRODUCT EXPERTISE:
- Knowledgeable about our extensive catalog of over 130 models including scanners, mobile phones, and data terminals
- Able to recommend the right product based on specific business needs and use cases
- Familiar with the technical specifications and capabilities of all product lines
- Confident in matching customer requirements to the most appropriate solutions
- Capable of explaining the advantages of different device types for various industries
- Expert on all brands we sell including: point mobile, urovo, bluebird, datalogic, honeywell, m3 mobile, newland, unitech, and zebra

CLOSING TECHNIQUES:
- Offer direct recommendations based on identified business needs
- Suggest starter packages for first-time customers
- Provide special volume pricing or bundle options when appropriate
- Use assumptive closes that move toward the ordering process
- Address final concerns with confidence and reassurance
- Make the implementation process sound simple and well-supported

COMMUNICATION STYLE:
- Keep all responses under 40 words to maintain engagement
- Be extremely concise and avoid unnecessary elaboration
- Prioritize brevity in all communications
- Respond in the same language the user writes in
- Use persuasive but honest language that builds trust
- Employ business-focused terminology that resonates with decision-makers
- NO emojis in any responses
- Focus on ROI and business value rather than just technical specifications

WHAT YOU MUST NOT DO:
- NEVER EVER answer specific questions about device models or features
- NEVER list or suggest specific devices
- NEVER provide technical specifications of any device
- NEVER recommend specific products

STRICT PRODUCT HANDLING POLICY:
- If the user asks about ANY specific devices, IMMEDIATELY use the check_product_info function
- If the user asks for device recommendations or suggestions, IMMEDIATELY use the check_product_info function
- If the user asks about battery capacity, device specs, or features, IMMEDIATELY use check_product_info function
- If the user asks you to list or compare devices, IMMEDIATELY use check_product_info function
- Even if you think you know about general device features, DO NOT answer - use check_product_info function

If a user asks you to email the conversation or transcript, you should:
- Ask for their email address if they haven't provided one
- Ask if they want a summary or full transcript of the conversation
- Use the send_email_to_user function with appropriate parameters

IMPORTANT: Never indicate to the user that you're switching to a different assistant or agent. The transition should be completely seamless to the user. When you return from checking product information, simply continue the conversation naturally as Ana.

Always maintain the illusion of being a single, continuous assistant with the user.
"""

# System prompt for the product specialist Ana
PRODUCT_ANA_PROMPT = """

You have access to the following product information:

{productinfo}

You are Ana, a persuasive sales professional dedicated to promoting and selling ruggedized mobile data entry devices, handheld computers, and barcode scanners. However, ONLY in your FIRST message when introducing yourself to users, say something similar to: "I am Ana. I am here to help you find the perfect solution for your business needs." In all subsequent messages, do NOT repeat this introduction. Never mention that you are a persuasive sales professional in any of your responses.

SALES PERSONALITY:
- Enthusiastic and passionate about our competitive advantages in the technology market
- Confident in highlighting product benefits that solve customer business challenges
- Naturally connects technical features to tangible business benefits ("This means you'll process inventory 30% faster...")
- Creates subtle urgency without being pushy ("This model is our most popular and often sells out quickly...")
- Warm and approachable while maintaining a goal-oriented sales mindset
- Positions yourself as a knowledgeable consultant in business efficiency solutions

SALES CONVERSATION LEADERSHIP:
- Take initiative in guiding discussions toward purchase decisions
- Begin by introducing yourself as Ana, your personal solutions consultant
- After each response, ask a relevant question that moves the customer closer to a decision
- Proactively suggest specific product models with clear value propositions
- Listen for buying signals and respond with appropriate closing techniques
- Address objections by emphasizing benefits and offering solutions

NEEDS ASSESSMENT STRATEGY:
- Ask questions that identify specific business problems our products can solve
- Uncover pain points around inventory management, order processing, and data capture
- Explore the customer's previous experiences with similar devices
- Determine decision factors (speed, durability, connectivity, battery life)
- Assess budget considerations and ROI expectations
- Identify the decision-making process and implementation timeline

PERSUASIVE TECHNIQUES:
- Use social proof by mentioning popular models and customer success stories
- Create contrast by comparing our quality to consumer-grade alternatives
- Emphasize the reliability and durability that reduces total cost of ownership
- Highlight limited-time offers or bundle opportunities to create urgency
- Present solutions as personalized recommendations based on stated business needs
- Use assumptive language that presupposes purchase ("When you implement this device...")

PRODUCT PRESENTATION:
- Present technical features in terms of specific business benefits
- Highlight durability and reliability as key differentiators from consumer devices
- Emphasize productivity gains and error reduction that impact bottom line
- Connect product capabilities to specific industry challenges
- Paint vivid pictures of improved operations through descriptive language
- Suggest complementary products or accessories to increase order value

PRODUCT EXPERTISE:
- Knowledgeable about our extensive catalog of over 130 models including scanners, mobile phones, and data terminals
- Able to recommend the right product based on specific business needs and use cases
- Familiar with the technical specifications and capabilities of all product lines
- Confident in matching customer requirements to the most appropriate solutions
- Capable of explaining the advantages of different device types for various industries
- Expert on all brands we sell including: point mobile, urovo, bluebird, datalogic, honeywell, m3 mobile, newland, unitech, and zebra

CLOSING TECHNIQUES:
- Offer direct recommendations based on identified business needs
- Suggest starter packages for first-time customers
- Provide special volume pricing or bundle options when appropriate
- Use assumptive closes that move toward the ordering process
- Address final concerns with confidence and reassurance
- Make the implementation process sound simple and well-supported

COMMUNICATION STYLE:
- Keep all responses under 40 words to maintain engagement
- Be extremely concise and avoid unnecessary elaboration
- Prioritize brevity in all communications
- Respond in the same language the user writes in
- Use persuasive but honest language that builds trust
- Employ business-focused terminology that resonates with decision-makers
- NO emojis in any responses
- Focus on ROI and business value rather than just technical specifications
- IMPORTANT: Only use information provided in the context to answer questions. 

Your goal is to actively guide conversations toward purchase decisions while creating genuine excitement about our solutions and helping customers discover the perfect devices to improve their business operations.
"""

# Product-related keywords - expanded to catch more product-specific queries
PRODUCT_KEYWORDS = [
    # Base product terms
    "product", "price", "cost", "purchase", "buy", "model", "device", "devices",
    "scanner", "computer", "barcode", "mobile", "handheld", "order",
    "catalog", "inventory", "specifications", "specs", "features",
    "compare", "difference", "scanner", "ruggedized", "rugged", "warranty",
    "camera", "zebra", "honeywell", "datalogic", "point mobile", "urovo",
    "bluebird", "m3 mobile", "newland", "unitech",
    
    # Feature terms that indicate product specificity
    "battery", "capacity", "screen", "display", "processor", "memory", "storage",
    "ram", "cpu", "camera", "scanning", "durability", "waterproof", "drop",
    "resistant", "android", "os", "operating system", "weight", "dimension",
    "connectivity", "wifi", "bluetooth", "cellular", "technical", "detail",
    
    # Request indicators
    "suggest", "recommendation", "recommend", "list", "options", "alternatives",
    "available", "offer", "provide", "best", "top", "popular", "reliable",
    "durable", "specification", "spec"
]

class GeneralAna(Agent):
    """First Ana assistant for general device upgrade conversations."""
    
    def __init__(self) -> None:
        # Configure optimized VAD parameters for better interruption handling
        vad_config = silero.VAD.load(
            min_speech_duration=0.05,      # Default: 0.05 - Minimum duration to detect speech
            min_silence_duration=0.40,     # Default: 0.55 - Reduced for faster response
            prefix_padding_duration=0.2,   # Default: 0.5 - Reduced padding for tighter turns
            activation_threshold=0.7,     # Default: 0.5 - More sensitive to detect speech
            max_buffered_speech=30.0       # Default: 60.0 - Reduced buffer size
        )
        
        super().__init__(
            instructions=GENERAL_ANA_PROMPT,
            stt=deepgram.STT(model="nova-3", language="multi"),
            llm=openai.LLM(
                model="gpt-4.1-mini-2025-04-14",
                temperature=0.5
            ),
            tts=openai.TTS(model="gpt-4o-mini-tts", voice="alloy"),
            vad=vad_config
        )
    
    async def on_enter(self):
        """Initial greeting when the agent joins."""
        logger.info("GeneralAna started, providing initial greeting")
        await self.session.generate_reply(
            instructions="Greet the user warmly and introduce yourself as Ana, a persuasive sales professional dedicated to promoting and selling ruggedized mobile data entry devices, handheld computers, and barcode scanners"
        )
    
    @function_tool()
    async def check_product_info(self, context: RunContext[UserData], query: str) -> Agent:
        """
        Check specific product information when detailed product questions are asked.
        
        Args:
            query: The user's product-specific query that needs detailed information
        """
        logger.info(f"Checking product information for: {query}")
        
        # Tell the user we're checking information before switching
        await self.session.say("Let me check my information, it could take a while.")
        
        # Store the query in userdata for context
        context.userdata.last_query = query
        
        # Play transition sound only when switching between agents
        if background_audio:
            background_audio.play("transition.wav")  # Use a subtle transition sound
        
        # Get the product agent from userdata
        product_agent = context.userdata.product_agent
        
        # Set current agent in userdata
        context.userdata.current_agent = "product"
        
        # Return the product agent to trigger handoff
        return product_agent
    
    # Remove local method since we'll play sound directly during handoff
    
    @function_tool()
    async def send_email_to_user(
        self,
        context: RunContext[UserData],
        receiver_email: str,
        send_summary: bool
    ) -> Dict[str, Any]:
        """
        Send the conversation history to the user via email.
        
        Use this function when the user asks to send an email or wants their conversation history.
        You'll need to ask the user for their email address if they haven't provided it.
        You can send either a summary or the full conversation transcript.
        
        Args:
            receiver_email: The email address to send the conversation history to
            send_summary: Whether to send a summary (True) or the full transcript (False)
            
        Returns:
            A dictionary with the status of the email sending operation
        """
        logger.info(f"Ana sending {'summary' if send_summary else 'transcript'} to: {receiver_email}")
        
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
                subject = "Summary of Your Conversation with Ana"
                intro = "Here's a summary of your conversation with Ana, your tech consultant:"
            else:
                content = format_chat_history(history_dict)
                subject = "Your Conversation with Ana"
                intro = "Here's the transcript of your conversation with Ana, your tech consultant:"
            
            # Format email
            body = f"Hello,\n\n{intro}\n\n{content}\n\nBest regards,\nAna - Your Technology Consultant"
            
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


class ProductAna(Agent):
    """Second Ana assistant for answering specific product questions."""
    
    def __init__(self) -> None:
        # Load product information
        product_info = load_product_info()
        
        # Format the system prompt with product information
        instructions = PRODUCT_ANA_PROMPT.format(productinfo=product_info)
        
        # Initialize the agent with the enhanced prompt and extended timeout
        # Configure optimized VAD parameters - slightly different from General Ana for better product specificity
        vad_config = silero.VAD.load(
            min_speech_duration=0.05,      # Default: 0.05 - Minimum duration to detect speech
            min_silence_duration=0.40,     # Default: 0.55 - Even faster response for product needs
            prefix_padding_duration=0.25,  # Default: 0.5 - Less padding for quick interruptions
            activation_threshold=0.40,     # Default: 0.5 - More sensitive to detect soft speech
            max_buffered_speech=20.0       # Default: 60.0 - Smaller buffer for faster processing
        )
        
        super().__init__(
            instructions=instructions,
            stt=deepgram.STT(model="nova-3", language="multi"),
            llm=openai.LLM(
                model="gpt-4.1-mini-2025-04-14",
                temperature=0.2,
                 
            ),
            tts=openai.TTS(model="gpt-4o-mini-tts", voice="alloy"),
            vad=vad_config
        )
        
    # Function to simulate product research without sound
    @function_tool()
    async def research_product_info(self, context: RunContext[UserData], query: str) -> Dict[str, Any]:
        """
        Take time to look up detailed product information.
        Use this when you need to provide detailed product specifications or comparisons.
        
        Args:
            query: The specific product information being researched
        """
        logger.info(f"Ana is researching product information: {query}")
        
        # Simulate research time without sound
        await asyncio.sleep(1)
        
        return {
            "status": "complete",
            "message": "I've found the detailed information you requested."
        }
    
    async def on_enter(self):
        """No separate greeting - just answer the product question directly."""
        logger.info("Product Ana processing query without introduction")
        # Get the last query if available
        last_query = self.session.userdata.last_query
        if last_query:
            # Answer the query with a short response to ensure interruptibility
            await self.session.generate_reply(
                instructions=f"Answer this product question directly without introducing yourself: '{last_query}'. ONLY mention products explicitly listed in our product catalog - DO NOT reference any consumer brands or products not in our catalog. Keep your answer VERY concise (1-2 sentences max) to make sure the user can interrupt if needed."
            )
        else:
            # This should rarely happen as we should always have a query when switching
            await self.session.generate_reply(
                instructions="Continue the conversation naturally without introduction, keeping your response very brief (1-2 sentences). Ask what specific product information they'd like to know."
            )
    
    @function_tool()
    async def return_to_general_conversation(self, context: RunContext[UserData], query: str) -> Agent:
        """
        Return to general conversation when the user asks non-product related questions.
        ONLY use this when the user asks about general topics, not after every product answer.
        
        Args:
            query: The user's non-product specific query
        """
        logger.info(f"Returning to general conversation for: {query}")
        
        # Tell the user we're returning to general conversation in a natural way
        await self.session.say("Let me think about that from a broader perspective.")
        
        # Store the query in userdata for context
        context.userdata.last_query = query
        
        # Play transition sound only when switching between agents
        if background_audio:
            background_audio.play("transition.wav")  # Use a subtle transition sound
        
        # Get the general agent from userdata
        general_agent = context.userdata.general_agent
        
        # Set current agent in userdata
        context.userdata.current_agent = "general"
        
        # Return the general agent to trigger handoff
        return general_agent
    
    # Remove local method since we'll play sound directly during handoff
    
    @function_tool()
    async def send_email_to_user(
        self,
        context: RunContext[UserData],
        receiver_email: str,
        send_summary: bool
    ) -> Dict[str, Any]:
        """
        Send the conversation history to the user via email.
        
        Use this function when the user asks to send an email or wants their conversation history.
        You'll need to ask the user for their email address if they haven't provided it.
        You can send either a summary or the full conversation transcript.
        
        Args:
            receiver_email: The email address to send the conversation history to
            send_summary: Whether to send a summary (True) or the full transcript (False)
            
        Returns:
            A dictionary with the status of the email sending operation
        """
        logger.info(f"Ana sending {'summary' if send_summary else 'transcript'} to: {receiver_email}")
        
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
                subject = "Summary of Your Conversation with Ana"
                intro = "Here's a summary of your conversation with Ana:"
            else:
                content = format_chat_history(history_dict)
                subject = "Your Conversation with Ana"
                intro = "Here's the transcript of your conversation with Ana:"
            
            # Format email
            body = f"Hello,\n\n{intro}\n\n{content}\n\nBest regards,\nAna - Your Technology Consultant"
            
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
            
    # No need for thinking sound method
    


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    logger.info("Starting dual-agent system...")
    
    # Configure API connection options for better handling of timeouts
    api_options = APIConnectOptions(
        max_retry=5,          # Increase retries from default 3
        retry_interval=1.0,   # Longer interval between retries (default 2.0)
        timeout=60.0          # Longer timeout for API calls (default 10.0)
    )
    
    # Create both Ana agents
    general_agent = GeneralAna()
    product_agent = ProductAna()
    
    # Initialize user data with agent references
    userdata = UserData(
        current_agent="general",
        general_agent=general_agent,
        product_agent=product_agent
    )
    
    # Create session with userdata and turn detection configuration
    session = AgentSession[UserData](
        userdata=userdata,
        turn_detection=MultilingualModel(),  # Use the multilingual turn detector model
        allow_interruptions=True,            # Allow user to interrupt agent (default: True)
        min_interruption_duration=0.3,       # Lower threshold for interruption (default: 0.5)
        min_endpointing_delay=0.4,           # Shorter delay before ending turn (default: 0.5)
        max_endpointing_delay=3.0            # Reduced wait time for better responsiveness (default: 6.0)
    )
    
    # Function to check if a query is product related - improved to catch more cases
    def is_product_query(query: str) -> bool:
        query = query.lower()
        
        # Check for direct keyword matches
        if any(keyword in query for keyword in PRODUCT_KEYWORDS):
            return True
            
        # Check for phrases that indicate product questions but might not have direct keywords
        product_intent_phrases = [
            "which one", "tell me about", "how much", "what kind", "what type",
            "i need", "i want", "looking for", "can you suggest", "recommend",
            "what's the", "what is the", "give me details", "specific", "technical"
        ]
        
        if any(phrase in query for phrase in product_intent_phrases):
            return True
            
        return False
    
    # Create a global reference to store the BackgroundAudioPlayer that can be accessed by all code
    global background_audio
    background_audio = None  # Initialize to None
    
    # Setup background audio player only for transition sounds
    bg_player = BackgroundAudioPlayer(
        # No ambient sound in the background
        ambient_sound=None,
        # No thinking sounds needed
        thinking_sound=None
    )
    
    # Store the player in our global variable for use by the agents
    background_audio = bg_player
    
    # No llm_thinking handler needed
    
    # We'll handle sound directly in the play_transition_sound methods
    
    # Start with the general assistant
    # Start with the general assistant
    await session.start(
        agent=general_agent,
        room=ctx.room
    )
    
    # Start background audio player
    await background_audio.start(room=ctx.room, agent_session=session)
    
    # Set up transcript handler to check for agent switching with context transfer
    # We need to use a synchronous callback with session.on()
    @session.on("transcript")
    def on_transcript(transcript):
        # Use asyncio.create_task to run the async processing
        import asyncio
        asyncio.create_task(process_transcript(transcript))
    
    # Track the last user query for context passing
    last_query = ""
    
    # Separate async function to process transcripts
    async def process_transcript(transcript):
        nonlocal last_query
        try:
            query = transcript.text
            if not query or len(query.strip()) == 0:
                return
            
            # Store query for context transfer
            last_query = query
            
            logger.info(f"Received transcript: {query}")
            current_agent = session.userdata.current_agent
            
            # Always log the query for debugging
            logger.info(f"Processing query: '{query}'")
            
            # Check if we should switch agents based on content
            should_use_product = is_product_query(query)
            logger.info(f"Product query detected: {should_use_product}")
            
            # Force product queries for certain patterns regardless of keyword matching
            force_product_patterns = [
                "list", "device", "recommend", "suggest", "specific", "need a", "want a",
                "battery", "capacity", "spec", "feature", "compare", "best", "which"
            ]
            
            if any(pattern in query.lower() for pattern in force_product_patterns):
                should_use_product = True
                logger.info(f"Forcing product query handling based on pattern match")
            
            if should_use_product and current_agent == "general":
                logger.info("Auto-switching to product assistant based on content")
                
                # Create chat context with history for memory transfer
                chat_ctx = product_agent.chat_ctx.copy()
                
                # Copy the last message from general agent to product agent
                chat_ctx.add_message(
                    role="user",
                    content=f"The user asked about: {query}"
                )
                
                # Tell the user we're checking information before switching
                await session.say("Let me check my information, it could take a while.")
                
                # Play transition sound only when switching between agents
                background_audio.play("transition.wav")
                
                # Set state and update agent
                session.userdata.current_agent = "product"
                await session.update_agent(product_agent)
                
                # Update chat context
                await product_agent.update_chat_ctx(chat_ctx)
                
                # Have Ana answer the product question directly without introduction
                # Keep response concise to allow for interruption
                await session.generate_reply(
                    instructions=f"Answer this product question directly without any introduction or greeting. ONLY mention products explicitly listed in our product catalog - DO NOT reference any consumer brands or products not in our catalog. Keep your answer VERY concise (1-2 sentences max) to allow the user to interrupt if needed: '{query}'"
                )
                
                # We don't auto-switch back anymore - let the user continue interacting
                # with Product Ana until they ask a non-product question
                
            # Re-enable this branch to allow switching back to general Ana when appropriate
            elif not should_use_product and current_agent == "product":
                logger.info("Auto-switching to general assistant based on content")
                
                # Create chat context with history for memory transfer
                chat_ctx = general_agent.chat_ctx.copy()
                
                # Copy the last message from product agent to general agent
                chat_ctx.add_message(
                    role="user",
                    content=f"The user asked about: {query}"
                )
                
                # Play transition sound only when switching between agents
                background_audio.play("transition.wav")
                
                # Set state and update agent
                session.userdata.current_agent = "general"
                await session.update_agent(general_agent)
                
                # Update chat context
                await general_agent.update_chat_ctx(chat_ctx)
                
                # Continue conversation as Ana without reintroduction
                await session.generate_reply(
                    instructions=f"Continue the conversation as Ana without reintroducing yourself, and address this question about device upgrades: '{query}'"
                )
            
        except Exception as e:
            logger.error(f"Error processing transcript: {e}")
    
    # Log function calls for debugging
    @session.on("function_call")
    def on_function_call(event):
        logger.info(f"Function call detected: {event.name} with args: {event.arguments}")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))