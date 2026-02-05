import os
import json
from datetime import datetime
from google import genai

# New SDK - gets key from environment
client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """You are generating THE TRIDENT BRIEF - a professional intelligence digest for {date}.

CRITICAL: This is a REAL intelligence brief. NO fiction, hypotheticals, or speculative scenarios. Only factual reporting with sources.

Create sections:

## I. GEOPOLITICAL FLASHPOINTS
Real developments in international relations, conflicts, diplomatic activities. Cite news sources (Reuters, AP, WSJ, FT, etc.). Current factual events only.

## II. TECHNOLOGY & POWER CONSOLIDATION
Actual tech industry developments, AI advances, corporate actions, infrastructure projects. Real announcements and moves only. Cite sources.

## III. UAP/UFO DEVELOPMENTS  
Official government disclosures, Congressional hearings, credible institutional reports only. Include skeptical analysis. Distinguish between: (a) verified official statements, (b) unverified claims. No sci-fi speculation.

## IV. PSI/PARAPSYCHOLOGY RESEARCH
Academic institutional research, peer-reviewed studies, meta-analyses only. Include mainstream scientific consensus and criticism. Real research institutions only.

## ASSESSMENT
Synthesize the most significant developments across all sections. Focus on verifiable implications.

REQUIREMENTS:
- 1500-2000 words
- Every claim must cite a real source (publication name, date if available)
- No fiction, creative scenarios, or "what if" speculation
- Distinguish clearly between verified facts and unverified claims
- Include critical/skeptical perspectives, especially for fringe topics
- Use measured, professional intelligence analyst tone

Generate factual brief for {date}."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    print(f"Generating brief for {today}...")
    
    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=PROMPT.format(date=today)
        )
        
        brief_text = response.text
        
        brief_data = {
            "date": today,
            "content": brief_text,
            "generated_at": datetime.now().isoformat()
        }
        
        with open('latest-brief.json', 'w') as f:
            json.dump(brief_data, f, indent=2)
        
        os.makedirs('archive', exist_ok=True)
        with open(f"archive/{datetime.now().strftime('%Y-%m-%d')}.md", 'w') as f:
            f.write(brief_text)
        
        print("✅ Brief generated!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        with open('latest-brief.json', 'w') as f:
            json.dump({"date": today, "content": f"Error: {e}", "generated_at": datetime.now().isoformat()}, f)

if __name__ == "__main__":
    generate_brief()





