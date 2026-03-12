
import os
import json
from pathlib import Path

TEMPLATE_PATH = "../templates"
DOCS_PATH = "../docs/collections"

def load_template(name):
    with open(os.path.join(TEMPLATE_PATH, name)) as f:
        return f.read()

def generate_collection(data):
    template = load_template("collection_template.md")
    youtube_template = load_template("youtube_embed.md")

    youtube_block = youtube_template.format(
        youtube_id=data["youtube_id"]
    )

    content = template.format(
        title=data["title"],
        category=data["category"],
        resolution=data["resolution"],
        formats=data["formats"],
        description=data["description"],
        youtube_block=youtube_block
    )

    slug = data["title"].lower().replace(" ", "-")
    output = Path(DOCS_PATH) / f"{slug}.md"

    with open(output, "w", encoding="utf8") as f:
        f.write(content)

    print("Created:", output)


def generate_reddit(data):
    template = load_template("reddit_template.md")

    slug = data["title"].lower().replace(" ", "-")

    post = template.format(
        title=data["title"],
        category=data["category"],
        youtube_id=data["youtube_id"],
        slug=slug
    )

    print("\n----- REDDIT POST -----\n")
    print(post)


if __name__ == "__main__":

    sample = {
        "title": "Neuron Network Backgrounds",
        "category": "Scientific Visuals",
        "resolution": "8K",
        "formats": "MP4, JPG",
        "youtube_id": "VIDEO_ID",
        "description": "High resolution neural network style motion backgrounds."
    }

    generate_collection(sample)
    generate_reddit(sample)
