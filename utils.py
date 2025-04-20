import os
import yaml
import logging

logger = logging.getLogger("dual-agent")

def load_prompt(filename):
    """Load a prompt from a YAML file."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    prompt_path = os.path.join(script_dir, 'prompts', filename)
    
    try:
        with open(prompt_path, 'r', encoding='utf-8') as file:
            prompt_data = yaml.safe_load(file)
            return prompt_data.get('instructions', '')
    except (FileNotFoundError, yaml.YAMLError) as e:
        logger.error(f"Error loading prompt file {filename}: {e}")
        return ""

def load_product_info():
    """Load the product information from the final.md file."""
    try:
        logger.debug(f"Loading markdown file from final.md")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(script_dir, 'final.md')
        
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        logger.debug(f"Content loaded successfully. Content length: {len(content)} characters.")
        return content
    
    except FileNotFoundError:
        logger.error(f"The final.md file was not found.")
        return "Product information not available."
    except Exception as e:
        logger.error(f"An error occurred loading product information: {e}")
        return "Product information not available."