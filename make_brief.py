import os
import json
from datetime import datetime
import google.generativeai as genai

genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """Generate THE TRIDENT BRIEF for {date}.

Include:
I. Geopolitical Flashpoints
II. Technology & Power
III. UAP/UFO Developments  
IV. Psi Research
V. Assessment

1500 words, cite sources."""

def generate_brief():
    today = datetime.now().strftime("%B %d, %Y")
    print(f"Generating brief for {today}...")
    
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(PROMPT.format(date=today))
        
        brief_data = {
            "date": today,
            "content": response.text,
            "generated_at": datetime.now().isoformat()
        }
        
        with open('latest-brief.json', 'w') as f:
            json.dump(brief_data, f, indent=2)
        
        os.makedirs('archive', exist_ok=True)
        with open(f"archive/{datetime.now().strftime('%Y-%m-%d')}.md", 'w') as f:
            f.write(response.text)
        
        print("✅ Brief generated!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        with open('latest-brief.json', 'w') as f:
            json.dump({"date": today, "content": f"Error: {e}", "generated_at": datetime.now().isoformat()}, f)

if __name__ == "__main__":
    generate_brief()

