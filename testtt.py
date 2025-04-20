import logging
from dotenv import load_dotenv


from livekit.agents import (
    APIConnectOptions
)

from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    openai,
    deepgram,
    silero
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv()

import re

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

def clean_markdown(content):
    logging.debug("Cleaning markdown content.")
    
    # Remove lines that are only header markers like ### or ##
    cleaned_content = re.sub(r'^\s*#+\s*', '', content, flags=re.MULTILINE)  # Remove markdown headers

    # Remove list markers (like '-' and '•' and '1.' for ordered lists)
    cleaned_content = re.sub(r'^\s*[-•*]\s*', '', cleaned_content, flags=re.MULTILINE)  # Remove list markers

    # Optional: Remove extra spaces, newlines, or unwanted characters if needed
    cleaned_content = re.sub(r'\s+', ' ', cleaned_content)  # Replace multiple spaces with one
    cleaned_content = re.sub(r'\n+', '\n', cleaned_content)  # Replace multiple newlines with one

    logging.debug("Finished cleaning markdown content.")
    return cleaned_content

def load_and_clean_markdown(file_path):
    try:
        logging.debug(f"Loading markdown file from {file_path}")
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()

        cleaned_content = clean_markdown(content)
        logging.debug(f"Cleaned content loaded successfully. Content length: {len(cleaned_content)} characters.")
        return cleaned_content
    
    except FileNotFoundError:
        logging.error(f"The file at {file_path} was not found.")
        return None
    except Exception as e:
        logging.error(f"An error occurred: {e}")
        return None

# Example usage:
file_path = 'final.md'  # Replace with your file path
cleaned_content = load_and_clean_markdown(file_path)

# If no content is loaded, exit early
if cleaned_content is None:
    logging.error("No product information available. Exiting.")
    exit(1)

# Ensure cleaned content is passed correctly to the Assistant
logging.debug(f"Passing cleaned content to the Assistant. Content length: {len(cleaned_content)} characters.")

class Assistant(Agent):
    def __init__(self, product_info: str) -> None:
        logging.debug("Initializing Assistant with provided product info.")
        super().__init__(instructions=f"""
        You are a helpful AI assistant specifically designed to assist with product-related inquiries.
        You can only provide answers based on the product information provided in the markdown document.
        Do not make any assumptions or provide information outside of the product details in the markdown file.
        Your responses should be concise and limited to the information within the file. If a question does not relate to the product or is not covered by the product details, inform the user politely that the information is not available.

        Here is the product information you have access to:
        {product_info}
        """)

async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    api_options = APIConnectOptions(
        max_retry=5,          # Increase retries from default 3
        retry_interval=0.2,   # Longer interval between retries (default 2.0)
        timeout=60.0          # Longer timeout for API calls (default 10.0)
    )
    # Create the agent session with the correct product info passed in
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=openai.LLM(model="gpt-4.1-mini", temperature=0.2),
        tts=openai.TTS(model="gpt-4o-mini-tts"),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    # Pass the cleaned product info to the Assistant when creating it
    assistant = Assistant(product_info=cleaned_content)

    await session.start(
        room=ctx.room,
        agent=assistant,
        room_input_options=RoomInputOptions(),
    )

    await session.generate_reply(
        instructions="Greet the user and offer your assistance."
    )

if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
