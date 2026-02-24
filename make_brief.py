import os
import json
from datetime import datetime
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """You are generating THE TRIDENT BRIEF - a rigorously fact-checked intelligence digest for {date}.

USE GOOGLE SEARCH to find current information. Search extensively before making claims.

CRITICAL REQUIREMENTS:
1. SEARCH for recent developments in each category
2. CITE specific sources with dates and URLs when available
3. Cross-reference claims across multiple sources
4. Flag VERIFIED vs REPORTED information
5. Include skeptical perspectives for fringe topics
6. Note when sources conflict

SOURCING PRIORITY:
- Tier 1: Reuters, AP, Bloomberg, WSJ, FT, NYT, WaPo, BBC, official govt sites
- Tier 2: Reputable regional outlets, defense publications
- For UAP/Psi: Only institutional sources, peer-reviewed research, official statements

## I. GEOPOLITICAL FLASHPOINTS
Search for and report current international conflicts, diplomatic moves, security developments.
Cite sources with dates. Note verification status.

## II. TECHNOLOGY & POWER CONSOLIDATION
Search for major tech moves, AI developments, regulatory actions, infrastructure.
Cite sources with dates.

## III. UAP/UFO DEVELOPMENTS
Search ONLY for: official govt statements, Congressional activity, peer-reviewed research, credible journalism.
Include skeptical counterpoints. NO social media rumors or unverified claims.

## IV. PSI/PARAPSYCHOLOGY RESEARCH
Search for: peer-reviewed studies, university research, meta-analyses.
Include mainstream scientific consensus. NO anecdotal claims.

## ASSESSMENT
Synthesize verified developments. Note pending verification or conflicting sources.

FORMAT:
- Cite source and date for every claim
- 1800-2200 words
- Professional intelligence tone
- NO speculation or fiction

Search and generate factual brief for {date}."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    print(f"Generating grounded brief for {today} with Google Search...")
    
    try:
        # Use Gemini with Google Search grounding
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=PROMPT.format(date=today),
            config=types.GenerateContentConfig(
                temperature=0.4,
                top_p=0.95,
                top_k=40,
                max_output_tokens=8192,
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        
        brief_text = response.text
        
        # Check if grounding metadata exists
        if hasattr(response, 'grounding_metadata'):
            print(f"✅ Brief generated with Google Search grounding!")
        else:
            print(f"✅ Brief generated (grounding status unknown)")
        
        brief_data = {
            "date": today,
            "content": brief_text,
            "generated_at": datetime.now().isoformat(),
            "grounded": True
        }
        
        with open('latest-brief.json', 'w') as f:
            json.dump(brief_data, f, indent=2)
        
        os.makedirs('archive', exist_ok=True)
        with open(f"archive/{datetime.now().strftime('%Y-%m-%d')}.md", 'w') as f:
            f.write(brief_text)
        
        print("✅ Grounded brief saved!")
        
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
