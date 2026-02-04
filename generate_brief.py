# Force run import os
import json
from datetime import datetime
import google.generativeai as genai

# Configure Gemini
genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """Generate a comprehensive intelligence brief called "THE TRIDENT BRIEF 🔱" for today.

Today's date: {date}

Create a brief with these sections:

## I. GEOPOLITICAL FLASHPOINTS
Major geopolitical developments, conflicts, diplomatic moves. Cite sources.

## II. TECHNOLOGY & POWER CONSOLIDATION  
Key tech developments, AI advances, corporate moves, infrastructure. Cite sources.

## III. THE FRINGE - UAP/UFO DEVELOPMENTS
Official UAP/UFO disclosures, Congressional activity, credible sightings. Include skeptical counterpoints.

## IV. PSI/PARAPSYCHOLOGY RESEARCH STATUS
Academic research updates, institutional developments, meta-analyses. Include mainstream consensus.

## ASSESSMENT
Brief synthesis of critical developments and implications.

Requirements:
- Search current news extensively
- Cite all claims with sources
- Expert-level analysis
- Separate facts from speculation
- 1500-2000 words
- Include skeptical perspectives on fringe topics

Generate the brief now for {date}."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    
    print(f"Generating brief for {today}...")
    
    try:
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        response = model.generate_content(PROMPT.format(date=today))
        
        brief_text = response.text
        
        # Save as JSON
        brief_data = {
            "date": today,
            "content": brief_text,
            "generated_at": datetime.now().isoformat()
        }
        
        with open('latest-brief.json', 'w') as f:
            json.dump(brief_data, f, indent=2)
        
        # Save to archive
        os.makedirs('archive', exist_ok=True)
        with open(f"archive/{datetime.now().strftime('%Y-%m-%d')}.md", 'w') as f:
            f.write(brief_text)
        
        print("✅ Brief generated successfully!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        error_data = {
            "date": today,
            "content": f"Error generating brief: {e}",
            "generated_at": datetime.now().isoformat()
        }
        with open('latest-brief.json', 'w') as f:
            json.dump(error_data, f, indent=2)

if __name__ == "__main__":
    generate_brief()
