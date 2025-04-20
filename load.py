import re

def clean_markdown(content):
    # Remove headers (lines starting with # followed by text)
    content = re.sub(r'^\s*#+\s*', '', content, flags=re.MULTILINE)

    # Remove horizontal rules (--- or ===)
    content = re.sub(r'^\s*[-=]{3,}\s*$', '', content, flags=re.MULTILINE)

    # Remove tables (keeping only text, removing pipes and rows)
    content = re.sub(r'^\|.*\|$', '', content, flags=re.MULTILINE)
    content = re.sub(r'\|', '', content)  # Remove vertical bars (pipes)
    
    # Remove image markdown syntax (![alt text](image_url))
    content = re.sub(r'!\[.*?\]\(.*?\)', '', content)

    # Optional: Remove extra spaces, newlines, or unwanted characters if needed
    content = re.sub(r'\s+', ' ', content)  # Replace multiple spaces with one
    content = re.sub(r'\n+', '\n', content)  # Replace multiple newlines with one

    return content.strip()

def load_and_clean_markdown(file_path, output_path):
    try:
        # Read the original markdown file
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Clean the content of the markdown file
        cleaned_content = clean_markdown(content)
        
        # Write the cleaned content to a new file
        with open(output_path, 'w', encoding='utf-8') as output_file:
            output_file.write(cleaned_content)
        
        print(f"Cleaned markdown saved to {output_path}")
    
    except FileNotFoundError:
        print(f"The file at {file_path} was not found.")
    except Exception as e:
        print(f"An error occurred: {e}")

# Example usage:
file_path = 'merged_output_cleaned.md'  # Replace with your original file path
output_path = 'final.md'  # Specify where you want to save the cleaned file

load_and_clean_markdown(file_path, output_path)
