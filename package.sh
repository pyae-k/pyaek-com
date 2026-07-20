#!/bin/bash

# Name of the output zip file
OUTPUT_FILE="pyaek-portfolio.zip"

echo "📦 Packaging project into $OUTPUT_FILE..."

# Remove existing zip if it exists
rm -f "$OUTPUT_FILE"

# Zip the current directory
# -r: recursive
# -x: exclude files/directories
zip -r "$OUTPUT_FILE" . \
    -x "*.git*" \
    -x "*.claude*" \
    -x "node_modules/*" \
    -x "dist/*" \
    -x ".DS_Store" \
    -x "*.mhtml" \
    -x "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Success! Your project has been zipped into $OUTPUT_FILE"
else
    echo "❌ Error occurred during zipping."
    exit 1
fi
