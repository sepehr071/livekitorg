def remove_empty_lines(input_file, output_file):
    with open(input_file, 'r', encoding='utf-8') as infile:
        lines = infile.readlines()

    # Remove empty lines
    cleaned_lines = [line for line in lines if line.strip() != '']

    with open(output_file, 'w', encoding='utf-8') as outfile:
        # Write the cleaned content back to the output file
        outfile.writelines(cleaned_lines)

# Specify the input (merged) file and output file
input_md_file = 'merged_output.md'  # Change this to your merged .md file
output_md_file = 'merged_output_cleaned.md'  # Output file without empty lines

remove_empty_lines(input_md_file, output_md_file)
print(f"Empty lines have been removed, and the cleaned file is saved as {output_md_file}")
