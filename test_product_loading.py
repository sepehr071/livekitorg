import logging
import os
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("product-info-test")

def load_product_info():
    """Load the product information from file with optimized buffer."""
    try:
        import time
        start_time = time.time()
        logger.info("Starting to load product information...")
        
        # Check if files exist before attempting to load
        for check_path in ["product-info.txt", "product-info.md"]:
            logger.info(f"Checking if {check_path} exists: {os.path.exists(check_path)}")
            if os.path.exists(check_path):
                try:
                    file_size = os.path.getsize(check_path)
                    logger.info(f"File {check_path} exists with size: {file_size/1024/1024:.2f}MB")
                except Exception as e:
                    logger.warning(f"Error checking size of {check_path}: {e}")
        
        # Try .txt file first, then fallback to .md if needed
        file_paths = ["product-info.txt", "product-info.md"]
        content = None
        file_loaded = None
        
        for file_path in file_paths:
            try:
                logger.info(f"Attempting to load from {file_path}...")
                # Increase buffer size to 4MB for efficient reading of large files
                with open(file_path, "r", encoding="utf-8", buffering=4*1024*1024) as file:
                    content = file.read()
                
                # If we got here, we successfully loaded the file
                file_loaded = file_path
                logger.info(f"Successfully loaded product info from {file_path}")
                break
            except FileNotFoundError:
                logger.warning(f"File {file_path} not found, trying next option if available")
            except UnicodeDecodeError:
                logger.error(f"Encoding issue with {file_path}, trying next option if available")
            except Exception as e:
                logger.error(f"Error loading from {file_path}: {e}")
        
        if not content:
            logger.error("Failed to load product information from any source")
            return "Product information not available."
        
        # Log performance metrics
        elapsed = time.time() - start_time
        file_size_mb = len(content) / (1024 * 1024)
        content_len = len(content)
        line_count = content.count('\n') + 1
        logger.info(f"Product information loaded from {file_loaded}: {file_size_mb:.2f}MB, {content_len} chars, {line_count} lines in {elapsed:.2f} seconds")
        
        # Validate content is not empty or too small
        if len(content.strip()) < 100:
            logger.error(f"Product information in {file_loaded} appears to be empty or too small (less than 100 chars)")
            return "Product information not available."
            
        return content
    except Exception as e:
        logger.error(f"Unexpected error loading product information: {e}")
        return "Product information not available."

if __name__ == "__main__":
    # Test loading product info
    print("Testing product info loading...")
    product_info = load_product_info()
    
    # Check the result
    if product_info == "Product information not available.":
        print("❌ Failed to load product information")
    else:
        print(f"✅ Product information loaded successfully!")
        print(f"Length: {len(product_info)} characters")
        print(f"First 100 chars: {product_info[:100]}...")
        print(f"Last 100 chars: {product_info[-100:]}...")