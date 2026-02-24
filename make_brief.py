import os
import json
from datetime import datetime
from google import genai

client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """You are generating THE TRIDENT BRIEF - a rigorously fact-checked intelligence digest for {date}.

CRITICAL REQUIREMENTS FOR FACTUAL ACCURACY:

1. SEARCH THE WEB extensively before making ANY claim
2. EVERY factual claim must cite a specific source with date
3. CROSS-REFERENCE major claims across multiple sources when possible
4. CLEARLY DISTINGUISH between verified and unverified information
5. Include SKEPTICAL perspectives especially for fringe topics
6. When sources conflict NOTE THE CONFLICT explicitly

SOURCING STANDARDS:
- Tier 1 sources: Reuters AP Bloomberg WSJ FT NYT WaPo BBC official govt statements
- Tier 2 sources: Reputable regional outlets established defense publications
- Always prefer original sources over aggregators
- For UAP/Psi topics: Only cite institutional sources peer-reviewed research or official statements

CREATE THESE SECTIONS:

## I. GEOPOLITICAL FLASHPOINTS
Search for and report on current international conflicts diplomatic developments and security issues.
For EACH major point cite source with publication and date.

## II. TECHNOLOGY & POWER CONSOLIDATION
Search for and report on major tech industry moves AI developments regulatory actions infrastructure projects.
For EACH major point cite specific source with date.

## III. UAP/UFO DEVELOPMENTS
Search ONLY for official government statements or hearings peer-reviewed research from credible institutions and credible investigative journalism from Tier 1/2 sources.
Include skeptical counterpoint or mainstream scientific view for each item.
DO NOT include social media rumors unverified sightings or speculative claims.

## IV. PSI/PARAPSYCHOLOGY RESEARCH
Search ONLY for peer-reviewed studies in recognized journals research from accredited universities/institutions and meta-analyses.
Include mainstream scientific consensus on the topic for each item.
DO NOT include anecdotal claims or non-peer-reviewed sources.

## ASSESSMENT
Synthesize the most significant verified developments.
Note any major stories where verification is pending or sources conflict.

FORMATTING:
- Every claim must cite source and date
- Total length 1800-2200 words
- Measured professional intelligence analyst tone
- NO speculation fiction or hypotheticals

Search extensively and generate factual brief for {date}."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    print(f"Generating fact-checked brief for {today}...")
    
    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",

            contents=PROMPT.format(date=today)
        )
        
        brief_text = response.text
        
        print(f"Brief generated successfully")
        
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
        
        print("Brief saved successfully")
        
    except Exception as e:
        print(f"Error: {e}")
        with open('latest-brief.json', 'w') as f:
            json.dump({"date": today, "content": f"Error: {e}", "generated_at": datetime.now().isoformat()}, f)

if __name__ == "__main__":
    generate_brief()
