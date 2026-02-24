import os
import json
from datetime import datetime
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """Generate THE TRIDENT BRIEF - a rigorously fact-checked intelligence digest for {date}.

YOU HAVE GOOGLE SEARCH ACCESS. Use it extensively to find current, verified information.

MANDATORY SOURCING REQUIREMENTS:

1. SEARCH THE WEB before making ANY factual claim
2. For EVERY major point, provide:
   - The claim
   - Source name (Reuters, AP, Bloomberg, etc.)
   - Publication date
   - If possible, include article title or URL reference
3. When multiple sources confirm: State "Verified by [Source 1], [Source 2]"
4. When single source: State "Reported by [Source]"
5. When sources conflict: "NOTE: [Source A] reports X while [Source B] reports Y"

SOURCE HIERARCHY (use in this order):
TIER 1: Reuters, Associated Press, Bloomberg, Wall Street Journal, Financial Times, New York Times, Washington Post, BBC News, official government websites
TIER 2: The Guardian, The Economist, Defense News, Jane's Defence, regional papers of record
TIER 3 (UAP/Psi ONLY): Peer-reviewed journals, university research, official Congressional records

SECTION REQUIREMENTS:

## I. GEOPOLITICAL FLASHPOINTS
Search for: International conflicts, diplomatic developments, security threats, major political events
Format each point as:
- [Development]
- Source: [Publication], [Date]
- Verification: [Verified/Reported/Conflicting]

## II. TECHNOLOGY & POWER CONSOLIDATION  
Search for: Tech industry moves, AI developments, regulatory actions, antitrust, infrastructure, cybersecurity
Format same as above with sources and dates.

## III. UAP/UFO DEVELOPMENTS
Search STRICTLY for:
- Official US government statements (DOD, NASA, ODNI)
- Congressional hearings or legislative activity
- Peer-reviewed scientific research
- Major investigative journalism from Tier 1 sources

For EACH item include:
- What was officially stated/reported
- By whom (agency, official name, publication)
- Date
- Skeptical scientific perspective or counterpoint
- Verification status

EXCLUDE: Social media claims, unverified sightings, conspiracy theories, anonymous sources

## IV. PSI/PARAPSYCHOLOGY RESEARCH
Search STRICTLY for:
- Peer-reviewed studies in recognized scientific journals
- Research from accredited universities
- Meta-analyses or systematic reviews

For EACH item include:
- Research finding
- Journal/institution, publication date
- Study methodology and sample size if available
- Mainstream scientific consensus or criticism
- Verification status

EXCLUDE: Anecdotal reports, non-peer-reviewed claims, pop psychology

## ASSESSMENT
Synthesize the most significant VERIFIED developments across all sections.
Note any major developing stories where verification is still pending.
Flag any areas where sources significantly conflict.

CRITICAL FORMAT RULES:
- Minimum 1800 words, maximum 2200 words
- Every factual claim must cite a source with date
- Use "According to [Source], [Date]..." construction
- When possible, reference specific article titles
- Professional intelligence analyst tone
- Zero speculation, zero fiction
- If you cannot verify a claim, do not include it

Begin search and generation now for {date}."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    print(f"Generating fact-checked brief for {today} with Google Search grounding...")
    
    try:
        # Generate with Google Search grounding
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=PROMPT.format(date=today),
            config=types.GenerateContentConfig(
                temperature=0.3,  # Lower for more factual output
                top_p=0.9,
                top_k=40,
                max_output_tokens=8192,
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        
        brief_text = response.text
        
        # Extract grounding metadata if available
        grounding_info = "Grounding metadata not available"
        if hasattr(response, 'grounding_metadata'):
            grounding_info = "Generated with Google Search grounding"
            print(f"✅ {grounding_info}")
        else:
            print(f"✅ Brief generated")
        
        # Count source citations
        source_count = brief_text.count("Source:") + brief_text.count("According to")
        verified_count = brief_text.count("Verified")
        reported_count = brief_text.count("Reported")
        
        print(f"   Citations: {source_count}")
        print(f"   Verified claims: {verified_count}")
        print(f"   Reported claims: {reported_count}")
        
        brief_data = {
            "date": today,
            "content": brief_text,
            "generated_at": datetime.now().isoformat(),
            "grounding": grounding_info,
            "stats": {
                "citations": source_count,
                "verified": verified_count,
                "reported": reported_count
            }
        }
        
        with open('latest-brief.json', 'w') as f:
            json.dump(brief_data, f, indent=2)
        
        os.makedirs('archive', exist_ok=True)
        archive_file = f"archive/{datetime.now().strftime('%Y-%m-%d')}.md"
        with open(archive_file, 'w') as f:
            f.write(f"# THE TRIDENT BRIEF\n")
            f.write(f"## {today}\n\n")
            f.write(f"*{grounding_info}*\n")
            f.write(f"*Citations: {source_count} | Verified: {verified_count} | Reported: {reported_count}*\n\n")
            f.write("---\n\n")
            f.write(brief_text)
        
        print(f"✅ Fact-checked brief saved to {archive_file}")
        
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
