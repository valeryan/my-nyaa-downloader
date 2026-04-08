#!/bin/bash

# Script to migrate season folders from "Season X" to "Season 0X" format
# Usage: ./migrate-season-folders.sh [path]
# Default path: /data/media

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default path or use first argument
MEDIA_PATH="${1:-/data/media}"

# Verify path exists
if [ ! -d "$MEDIA_PATH" ]; then
  echo -e "${RED}Error: Directory '$MEDIA_PATH' does not exist${NC}"
  exit 1
fi

echo -e "${GREEN}Season Folder Migration Script${NC}"
echo "Target directory: $MEDIA_PATH"
echo ""

# Counter for operations
DRY_RUN=true
RENAMED_COUNT=0
SKIPPED_COUNT=0

# Prompt for dry run or actual execution
read -p "Perform dry run first? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  DRY_RUN=true
  echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}"
else
  DRY_RUN=false
  echo -e "${RED}LIVE MODE - Folders will be renamed${NC}"
fi
echo ""

# Find all "Season X" folders where X is a single digit (1-9)
# -L follows symbolic links
while IFS= read -r -d '' folder; do
  # Extract the season number
  season_num=$(basename "$folder" | sed 's/Season //')

  # Get parent directory
  parent_dir=$(dirname "$folder")

  # Create new folder name with zero-padded season number
  new_folder="$parent_dir/Season 0$season_num"

  # Check if target already exists
  if [ -d "$new_folder" ]; then
    echo -e "${YELLOW}SKIP:${NC} $folder"
    echo "      Target already exists: $new_folder"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    echo -e "${GREEN}WOULD RENAME:${NC}"
    echo "  FROM: $folder"
    echo "  TO:   $new_folder"
    echo ""
    RENAMED_COUNT=$((RENAMED_COUNT + 1))
  else
    echo -e "${GREEN}RENAMING:${NC}"
    echo "  FROM: $folder"
    echo "  TO:   $new_folder"
    mv "$folder" "$new_folder"
    echo ""
    RENAMED_COUNT=$((RENAMED_COUNT + 1))
  fi
done < <(find -L "$MEDIA_PATH" -type d -name "Season [1-9]" -print0)

# Summary
echo ""
echo "==================== SUMMARY ===================="
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}DRY RUN COMPLETE${NC}"
  echo "Folders that would be renamed: $RENAMED_COUNT"
else
  echo -e "${GREEN}MIGRATION COMPLETE${NC}"
  echo "Folders renamed: $RENAMED_COUNT"
fi
echo "Folders skipped: $SKIPPED_COUNT"
echo ""

if [ "$DRY_RUN" = true ] && [ $RENAMED_COUNT -gt 0 ]; then
  echo -e "${YELLOW}To apply these changes, run:${NC}"
  echo "  ./migrate-season-folders.sh $MEDIA_PATH"
  echo ""
fi
