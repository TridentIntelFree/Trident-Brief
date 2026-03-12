import requests
import os
from datetime import datetime

def generate_with_grok(prompt):
api_key = os.environ.get(‘GROK_API_KEY’)
if not api_key:
return None, “No Grok API key”

```
try:
    response = requests.post(
        'https://api.x.ai/v1/responses',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        },
        json={
            'model': 'grok-4-1-fast-reasoning',
            'input': [
                {
                    'role': 'system',
                    'content': 'You are a SIGINT/HUMINT fusion analyst with real-time X/Twitter access and web search capabilities. Monitor verified official sources (SIGINT) and unverified local accounts (HUMINT/CHATTER). Also search the broader web for news, government sites, and intelligence sources. Distinguish between confirmed intelligence and uncorroborated chatter. Use professional intelligence terminology. Search X and the web RIGHT NOW.'
                },
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            'tools': [
                {'type': 'x_search'},
                {'type': 'web_search'}
            ],
            'temperature': 0.6
        },
        timeout=180
    )
    
    if response.status_code == 200:
        data = response.json()
        # Responses API: extract text from output array
        text_parts = []
        for item in data.get('output', []):
            # Direct text content in message items
            if item.get('type') == 'message':
                for block in item.get('content', []):
                    if block.get('type') == 'output_text':
                        text_parts.append(block.get('text', ''))
                    elif block.get('type') == 'text':
                        text_parts.append(block.get('text', ''))
        
        # Fallback: check output_text shorthand
        if not text_parts and data.get('output_text'):
            text_parts.append(data['output_text'])
        
        if text_parts:
            return '\n'.join(text_parts), None
        else:
            return None, f"Grok returned no text content. Keys: {list(data.keys())}"
    else:
        return None, f"Grok error: {response.status_code} - {response.text[:200]}"
except Exception as e:
    return None, str(e)
```

def generate_with_groq(prompt):
api_key = os.environ.get(‘GROQ_API_KEY’)
if not api_key:
return None, “No Groq API key”

```
try:
    response = requests.post(
        'https://api.groq.com/openai/v1/chat/completions',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        },
        json={
            'model': 'llama-3.3-70b-versatile',
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.6,
            'max_tokens': 4000
        },
        timeout=60
    )
    
    if response.status_code == 200:
        return response.json()['choices'][0]['message']['content'], None
    return None, "Groq error"
except Exception as e:
    return None, str(e)
```

def main():
timestamp = datetime.now().strftime(’%Y-%m-%d %H:%M UTC’)
readable_date = datetime.now().strftime(’%B %d, %Y at %H:%M UTC’)
year = str(datetime.now().year)

```
prompt = f"""SIGINT/HUMINT COLLECTION TASKING - REAL-TIME X/TWITTER MONITORING
```

Collection Period: Past 24 hours ending {readable_date}
Current Year: {year}

MISSION: Conduct multi-INT collection using verified official sources (SIGINT) and open chatter from local/unverified accounts (HUMINT). Use BOTH X/Twitter search AND web search to gather intelligence from multiple sources. Clearly distinguish intelligence grades.

INTELLIGENCE CLASSIFICATION SYSTEM:
[SIGINT - VERIFIED]: Official government, military, institutional accounts
[HUMINT - CHATTER]: Unverified local sources, citizen reports, rumors requiring corroboration
[OSINT - CONFIRMED]: Cross-verified by multiple independent sources
[OSINT - WEB]: Intelligence gathered from news sites, government portals, research institutions

PRIORITY INTELLIGENCE REQUIREMENTS:

1. GEOPOLITICAL AND MILITARY INTELLIGENCE

SIGINT COLLECTION TARGETS (Verified Official):
@POTUS @VP @StateDept @SecDef @DeptofDefense @NATO @EUCOM @CENTCOM @INDOPACOM @ZelenskyyUa @Ukrainian_Army @DefenceU @IDF @Israel_MOD @IsraeliPM @StateDeptSpox @PentagonPresSec

HUMINT SOURCES (Journalists/Analysts):
@christogrozev @RALee85 @Conflicts @WarMonitors @Osinttechnical @JackDetsch @laraseligman @NatashaBertrand

WEB SOURCES: Reuters, AP News, BBC, Defense One, War on the Rocks, CSIS, ISW (understandingwar.org)

Collection Focus:

- Troop movements and military deployments
- Diplomatic statements and policy shifts
- Alliance developments and joint operations
- Sanctions announcements
- Arms transfers and defense aid
- Strategic messaging

1. TECHNOLOGY AND CYBERSECURITY INTELLIGENCE

SIGINT TARGETS (Verified):
@elonmusk @sama @satyanadella @sundarpichai @tim_cook @OpenAI @Google @Microsoft @Apple @Meta @Tesla @SpaceX @xAI @USCYBERCOM @CISAgov @NSACyber @FBI

HUMINT SOURCES (Security Researchers):
@mattblaze @evacide @thegrugq @SwiftOnSecurity @troyhunt @briankrebs

WEB SOURCES: Ars Technica, The Verge, Wired, Krebs on Security, CISA.gov, BleepingComputer

Collection Focus:

- Product launches and breakthroughs
- Cybersecurity incidents
- AI policy developments
- Space programs
- Regulatory actions

1. UAP/UFO INTELLIGENCE

SIGINT TARGETS:
@DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett @SenRubioPress

HUMINT SOURCES:
@ChrisKMellon @LueElizondo @rosscoulthart @JeremyCorbell

WEB SOURCES: The Black Vault, Liberation Times, The Debrief, AARO official reports

Collection Focus:

- Official Pentagon statements
- Congressional hearings
- Credible incident reports
- Scientific research

1. PARAPSYCHOLOGY AND CONSCIOUSNESS RESEARCH

SIGINT TARGETS:
@Stanford @Harvard @Princeton @MIT @Yale @NaturePortfolio @ScienceMagazine

WEB SOURCES: Nature.com, Science.org, arXiv.org, university press releases

Collection Focus:

- Peer-reviewed publications
- Research program announcements
- Conference proceedings

INTELLIGENCE METHODOLOGY:

1. SIGINT COLLECTION: Monitor official accounts for authoritative statements, flag as [SIGINT - VERIFIED]
1. HUMINT COLLECTION: Monitor credible journalists/analysts, flag as [HUMINT - SOURCE ASSESSED]
1. CHATTER MONITORING: Search X for trending topics, local reports, flag as [HUMINT - CHATTER - UNVERIFIED]
1. WEB INTELLIGENCE: Search news sites, government portals, research databases, flag as [OSINT - WEB]
1. INTELLIGENCE FUSION: Cross-reference sources, upgrade confidence when sources align

REPORTING FORMAT:
Use classification tags for each intelligence item:
[SIGINT - VERIFIED] Official statement from @account at timestamp
[HUMINT - ASSESSED CREDIBLE] Reporter with track record reports
[HUMINT - CHATTER] Unverified reports (REQUIRES CORROBORATION)
[OSINT - WEB] News/research from named publication

Include:

- Source classification and confidence level
- Specific X accounts and timestamps
- Web source URLs when available
- Direct quotes when relevant
- Strategic implications

DISCLAIMER SECTION:
INTELLIGENCE DISCLAIMER:

- SIGINT (Verified): High confidence, official sources
- HUMINT (Assessed): Medium-high confidence, credible analysts
- CHATTER (Unverified): Low confidence, requires corroboration
- OSINT-WEB: Confidence varies by source reputation

VALIDATION REQUIREMENTS:

- Ukraine-Russia conflict MUST be addressed
- Middle East situation MUST be covered
- All examples from {year}
- Minimum 3 SIGINT sources per section
- Clearly mark all HUMINT/CHATTER sources
- Include at least 2 web-sourced items per section

Execute multi-INT collection now.”””

```
print("Initiating SIGINT/HUMINT collection with Grok 4.1 + x_search + web_search...")
content, error = generate_with_grok(prompt)

if content:
    provider = "Grok 4.1 Fast Reasoning - Multi-INT Fusion (X Search + Web Search)"
    badge = "GROK-4.1-MULTI-INT-FUSION"
else:
    print(f"Grok failed: {error}")
    print("Falling back to Groq...")
    content, error = generate_with_groq(prompt)
    if content:
        provider = "Groq Llama 3.3 (Backup)"
        badge = "GROQ-BACKUP"
    else:
        raise Exception(f"All providers failed: {error}")

grok_key = os.environ.get('GROK_API_KEY', '')

html = f'''<!DOCTYPE html>
```

<html>
<head>
    <meta charset="UTF-8">
    <title>Trident SIGINT Brief</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #0a0e27, #1a1f3a);
            color: #e0e6ed;
            padding: 20px;
            line-height: 1.6;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 12px;
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #1e293b, #0f172a);
            border-bottom: 2px solid #3b82f6;
            padding: 40px;
        }}
        .badge {{
            background: #dc2626;
            color: white;
            padding: 4px 12px;
            font-size: 11px;
            font-weight: 700;
            border-radius: 3px;
            display: inline-block;
            margin-bottom: 15px;
        }}
        h1 {{
            font-size: 2.5em;
            color: #3b82f6;
            text-transform: uppercase;
            margin-bottom: 10px;
        }}
        .meta {{
            color: #94a3b8;
            font-size: 0.9em;
            margin-top: 10px;
        }}
        .sigint {{
            color: #fbbf24;
            font-size: 0.8em;
            font-weight: 600;
            margin-top: 5px;
        }}
        .content {{
            padding: 40px;
        }}
        pre {{
            white-space: pre-wrap;
            font-family: inherit;
            line-height: 1.7;
        }}
        .local-intel {{
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 30px;
            margin: 20px 40px;
        }}
        .local-intel h2 {{
            color: #3b82f6;
            font-size: 1.3em;
            margin-bottom: 15px;
        }}
        .access-form {{
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 15px;
        }}
        .access-form input {{
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid rgba(59, 130, 246, 0.5);
            color: #e0e6ed;
            padding: 10px 15px;
            border-radius: 4px;
            font-size: 0.9em;
        }}
        .access-form button {{
            background: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9em;
        }}
        .access-form button:hover {{
            background: #2563eb;
        }}
        .error-msg {{
            color: #ef4444;
            font-size: 0.85em;
            margin-top: 10px;
        }}
        .success-msg {{
            color: #10b981;
            font-size: 0.85em;
            margin-top: 10px;
        }}
        #localBriefContent {{
            margin-top: 20px;
            padding: 20px;
            background: rgba(15, 23, 42, 0.6);
            border-radius: 4px;
            display: none;
        }}
        .footer {{
            background: #0f172a;
            border-top: 1px solid rgba(59, 130, 246, 0.3);
            padding: 25px;
            text-align: center;
            color: #64748b;
            font-size: 0.85em;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="badge">CLASSIFIED: SIGINT/HUMINT COLLECTION BRIEF</div>
            <h1>⚔️ THE TRIDENT BRIEF</h1>
            <div class="meta">Collection Period: {timestamp} | Source: {badge}</div>
            <div class="sigint">MULTI-INT FUSION | SIGINT + HUMINT + OSINT-WEB + CHATTER MONITORING</div>
        </div>

```
    <div class="content">
        <pre>{content}</pre>
    </div>
    
    <div class="local-intel">
        <h2>🎯 LOCAL INTELLIGENCE BRIEF (RESTRICTED ACCESS)</h2>
        <p style="color: #94a3b8; font-size: 0.9em; margin-bottom: 15px;">
            Generate a localized intelligence brief for your area (200-mile radius). 
            Includes: local law enforcement activity, crime trends, political developments, 
            business intelligence, and regional threats. Now powered by X search + web search for broader coverage.
        </p>
        <div class="access-form">
            <input type="password" id="accessCode" placeholder="4-digit access code" maxlength="4">
            <input type="text" id="zipCode" placeholder="ZIP code" maxlength="5">
            <button onclick="generateLocalBrief()">Generate Local Brief</button>
        </div>
        <div id="accessMessage"></div>
        <div id="localBriefContent"></div>
    </div>
    
    <div class="footer">
        AUTOMATED MULTI-INT COLLECTION SYSTEM | {provider} | DAILY 06:00 EST<br>
        MONITORING 100+ HIGH-VALUE X ACCOUNTS + WEB SOURCES | SIGINT + HUMINT + OSINT-WEB + CHATTER FUSION
    </div>
</div>

<script>
    async function generateLocalBrief() {{
        const code = document.getElementById('accessCode').value;
        const zip = document.getElementById('zipCode').value;
        const msgDiv = document.getElementById('accessMessage');
        const contentDiv = document.getElementById('localBriefContent');
        
        msgDiv.innerHTML = '';
        contentDiv.style.display = 'none';
        
        if (code !== '0330') {{
            msgDiv.innerHTML = '<p class="error-msg">❌ Invalid access code</p>';
            return;
        }}
        
        if (!/^\\d{{5}}$/.test(zip)) {{
            msgDiv.innerHTML = '<p class="error-msg">❌ Invalid ZIP code format</p>';
            return;
        }}
        
        msgDiv.innerHTML = '<p class="success-msg">⏳ Generating multi-source local brief for ZIP ' + zip + '... (60-90 seconds)</p>';
        
        try {{
            const prompt = `LOCALIZED INTELLIGENCE BRIEF - ZIP CODE ${{zip}}
```

Collection Period: Past 24 hours
Search Radius: 200 miles from ZIP ${{zip}}

MISSION: Generate tactical intelligence brief for local area using BOTH X/Twitter search AND web search. Pull from local news sites, police department websites, government portals, AND social media.

PRIORITY LOCAL INTELLIGENCE REQUIREMENTS:

1. LAW ENFORCEMENT & PUBLIC SAFETY

- Search X for local police, sheriff, fire/EMS accounts and incidents
- Search web for local news crime reports, police blotters, court records

1. CRIME & SECURITY THREATS

- Monitor X for crime reports, trends, gang activity, security concerns
- Search web for local newspaper crime sections, FBI field office alerts

1. LOCAL POLITICS & GOVERNMENT

- Track X for city council, county decisions, local elections, policy changes
- Search web for local government meeting minutes, press releases

1. BUSINESS & ECONOMIC INTELLIGENCE

- Monitor X for business openings/closings, corporate announcements
- Search web for local business journals, economic development news

1. REGIONAL THREATS & HAZARDS

- Search X for weather, disasters, infrastructure failures, health concerns
- Search web for NWS alerts, FEMA updates, state emergency management

INTELLIGENCE CLASSIFICATION:
[SIGINT - VERIFIED]: Official law enforcement, government accounts
[HUMINT - LOCAL CHATTER]: Community reports, citizen observations
[OSINT - NEWS]: Local news outlet reporting
[OSINT - WEB]: Government websites, official databases, verified web sources

Search X AND the web NOW for location-specific intelligence within 200 miles of ZIP ${{zip}}.`;

```
            const response = await fetch('https://api.x.ai/v1/responses', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer {grok_key}'
                }},
                body: JSON.stringify({{
                    model: 'grok-4-1-fast-reasoning',
                    input: [
                        {{
                            role: 'system',
                            content: 'You are a local intelligence analyst with real-time X/Twitter access and web search capabilities. Generate tactical intelligence for specific geographic areas. Search for local accounts, news sites, government portals, and chatter relevant to the specified location. Use both X search and web search to provide comprehensive coverage.'
                        }},
                        {{
                            role: 'user',
                            content: prompt
                        }}
                    ],
                    tools: [
                        {{ type: 'x_search' }},
                        {{ type: 'web_search' }}
                    ],
                    temperature: 0.6
                }})
            }});
            
            if (!response.ok) {{
                const errText = await response.text();
                throw new Error('API request failed: ' + response.status + ' - ' + errText.substring(0, 200));
            }}
            
            const data = await response.json();
            
            // Responses API: extract text from output array
            let briefContent = '';
            if (data.output_text) {{
                briefContent = data.output_text;
            }} else if (data.output) {{
                for (const item of data.output) {{
                    if (item.type === 'message' && item.content) {{
                        for (const block of item.content) {{
                            if (block.type === 'output_text' || block.type === 'text') {{
                                briefContent += block.text;
                            }}
                        }}
                    }}
                }}
            }}
            
            // Fallback: try old chat completions format just in case
            if (!briefContent && data.choices) {{
                briefContent = data.choices[0].message.content;
            }}
            
            if (!briefContent) {{
                throw new Error('No content in response. Keys: ' + Object.keys(data).join(', '));
            }}
            
            contentDiv.innerHTML = '<pre>' + briefContent + '</pre>';
            contentDiv.style.display = 'block';
            msgDiv.innerHTML = '<p class="success-msg">✅ Multi-source local brief generated successfully</p>';
            
        }} catch (error) {{
            msgDiv.innerHTML = '<p class="error-msg">❌ Error generating brief: ' + error.message + '</p>';
        }}
    }}
</script>
```

</body>
</html>'''

```
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f"✓ Brief generated successfully at {timestamp}")
```

if **name** == ‘**main**’:
main()
