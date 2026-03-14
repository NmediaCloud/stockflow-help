import os
import sys

def main():
    # Setup paths
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = os.path.dirname(SCRIPT_DIR)
    DOCS_DIR = os.path.join(BASE_DIR, 'docs')
    REDDIT_DIR = SCRIPT_DIR
    
    TARGET_FOLDERS = ['categories', 'subcategories', 'collections']
    
    GENERIC_TEMPLATE = """# Reddit Marketing - Generic Introduction

**Date:** [Insert Date]
**Target Subreddits:** r/Microbiology, r/Science, r/biology, [Add others]

## Title Ideas
- [Catchy Title 1]
- [Catchy Title 2]

## Introduction / Description
[Write a general introduction about Stockflow.media here. Describe what the website is, what we provide, what are the most famous assets, and our mission.]

## Link
https://help.stockflow.media/

## Keywords / Meta Tags
#science #microscopic #stockfootage #biology

## Checklist before posting
- [ ] Checked subreddit rules
- [ ] Added relevant flair
- [ ] Proofread description
"""

    SPECIFIC_TEMPLATE = """# Reddit Marketing - {name}

**Target Subreddits:** r/[Relevant Subreddit 1], r/[Relevant Subreddit 2]

## Title Ideas
- [Catchy Title for {name} 1]
- [Catchy Title for {name} 2]

## Description
[Describe the {name} assets. Mention specific details, highlights, and why it is useful for the audience.]

## Link
https://help.stockflow.media/{folder}/{filename_no_ext}

## Keywords / Meta Tags
#{name_nospace} #microscopic #stockfootage [Add more specific tags]

## Embedded Media / Assets
[Link to image/video to embed in the Reddit post]

## Checklist before posting
- [ ] Checked subreddit rules
- [ ] Added relevant flair
- [ ] Proofread description
"""

    print("--- Generating Reddit Marketing Data ---")
    
    # 1. Generate generic introduction
    generic_path = os.path.join(REDDIT_DIR, '00_generic_introduction.md')
    if not os.path.exists(generic_path):
        with open(generic_path, 'w', encoding='utf-8') as f:
            f.write(GENERIC_TEMPLATE)
        print(f"Created: {generic_path}")
    else:
        print(f"Skipped: {generic_path} (Already exists)")
        
    # 2. Iterate through categories, subcategories, and collections
    for folder in TARGET_FOLDERS:
        source_folder = os.path.join(DOCS_DIR, folder)
        dest_folder = os.path.join(REDDIT_DIR, folder)
        
        # Check if source folder exists
        if not os.path.exists(source_folder):
            print(f"Warning: Source folder {source_folder} not found, skipping...")
            continue
            
        # Ensure destination folder exists inside reddit_data
        if not os.path.exists(dest_folder):
            os.makedirs(dest_folder)
            
        # Go through files in the source docs folder
        for file in os.listdir(source_folder):
            if file.endswith('.md'):
                filename_no_ext = os.path.splitext(file)[0]
                
                # Skip placeholder files if necessary, or process them all
                
                # Format names for the template
                readable_name = filename_no_ext.replace('-', ' ').title()
                name_nospace = filename_no_ext.replace('-', '')
                
                dest_path = os.path.join(dest_folder, file)
                
                if not os.path.exists(dest_path):
                    content = SPECIFIC_TEMPLATE.format(
                        name=readable_name,
                        name_nospace=name_nospace,
                        folder=folder,
                        filename_no_ext=filename_no_ext
                    )
                    with open(dest_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    print(f"Created: {dest_path}")
                else:
                    print(f"Skipped: {dest_path} (Already exists)")

    print("--- Reddit Marketing Data Generation Complete ---")

if __name__ == '__main__':
    main()
