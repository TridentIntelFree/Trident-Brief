import requests
import os
from datetime import datetime

def generate_with_grok(prompt):
    api_key = os.environ.get('GROK_API_KEY')
    if not api_key:
        return None, "No Grok API key"
    
    try:
        response = requests.post(
            'https://api.x.ai/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            },
            json={
                'messages': [
                    {
                        'role': 'system',
                        'content': 'You are a SIGINT/HUMINT fusion analyst with real-time X/Twitter access. Monitor verified official sources (SIGINT) and unverified local accounts (HUMINT/CHATTER). Distinguish between confirmed intelligence and uncorroborated chatter. Use professional intelligence terminology. Access X RIGHT NOW.'
                    },
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'model': 'grok-4-1-fast-reasoning',
                'stream': False,
                'temperature': 0.6,
                'max_tokens': 4500
            },
            timeout=90
        )
        
        if response.status_code == 200:
            return response.json()['choices'][0]['message']['content'], None
        else:
            return None, f"Grok error: {response.status_code}"
    except Exception as e:
        return None, str(e)

def generate_with_groq(prompt):
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return None, "No Groq API key"
    
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

def main():
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M UTC')
    readable_date = datetime.now().strftime('%B %d, %Y at %H:%M UTC')
    year = str(datetime.now().year)
    
    prompt = f"""SIGINT/HUMINT COLLECTION TASKING - REAL-TIME X/TWITTER MONITORING
Collection Period: Past 24 hours ending {readable_date}
Current Year: {year}

MISSION: Conduct multi-INT collection using verified official sources (SIGINT) and open chatter from local/unverified accounts (HUMINT). Clearly distinguish intelligence grades.

INTELLIGENCE CLASSIFICATION SYSTEM:
[SIGINT - VERIFIED]: Official government, military, institutional accounts
[HUMINT - CHATTER]: Unverified local sources, citizen reports, rumors requiring corroboration
[OSINT - CONFIRMED]: Cross-verified by multiple independent sources

PRIORITY INTELLIGENCE REQUIREMENTS:

1. GEOPOLITICAL AND MILITARY INTELLIGENCE

SIGINT COLLECTION TARGETS (Verified Official):
@POTUS @VP @StateDept @SecDef @DeptofDefense @NATO @EUCOM @CENTCOM @INDOPACOM @ZelenskyyUa @Ukrainian_Army @DefenceU @IDF @Israel_MOD @IsraeliPM @StateDeptSpox @PentagonPresSec

HUMINT SOURCES (Journalists/Analysts):
@christogrozev @RALee85 @Conflicts @WarMonitors @Osinttechnical @JackDetsch @laraseligman @NatashaBertrand

Collection Focus:
- Troop movements and military deployments
- Diplomatic statements and policy shifts
- Alliance developments and joint operations
- Sanctions announcements
- Arms transfers and defense aid
- Strategic messaging

2. TECHNOLOGY AND CYBERSECURITY INTELLIGENCE

SIGINT TARGETS (Verified):
@elonmusk @sama @satyanadella @sundarpichai @tim_cook @OpenAI @Google @Microsoft @Apple @Meta @Tesla @SpaceX @xAI @USCYBERCOM @CISAgov @NSACyber @FBI

HUMINT SOURCES (Security Researchers):
@mattblaze @evacide @thegrugq @SwiftOnSecurity @troyhunt @briankrebs

Collection Focus:
- Product launches and breakthroughs
- Cybersecurity incidents
- AI policy developments
- Space programs
- Regulatory actions

3. UAP/UFO INTELLIGENCE

SIGINT TARGETS:
@DeptofDefense @AARO_DOD_Info @SenGillibrand @RepTimBurchett @SenRubioPress

HUMINT SOURCES:
@ChrisKMellon @LueElizondo @rosscoulthart @JeremyCorbell

Collection Focus:
- Official Pentagon statements
- Congressional hearings
- Credible incident reports
- Scientific research

4. PARAPSYCHOLOGY AND CONSCIOUSNESS RESEARCH

SIGINT TARGETS:
@Stanford @Harvard @Princeton @MIT @Yale @NaturePortfolio @ScienceMagazine

Collection Focus:
- Peer-reviewed publications
- Research program announcements
- Conference proceedings

INTELLIGENCE METHODOLOGY:
1. SIGINT COLLECTION: Monitor official accounts for authoritative statements, flag as [SIGINT - VERIFIED]
2. HUMINT COLLECTION: Monitor credible journalists/analysts, flag as [HUMINT - SOURCE ASSESSED]
3. CHATTER MONITORING: Search X for trending topics, local reports, flag as [HUMINT - CHATTER - UNVERIFIED]
4. INTELLIGENCE FUSION: Cross-reference sources, upgrade confidence when sources align

REPORTING FORMAT:
Use classification tags for each intelligence item:
[SIGINT - VERIFIED] Official statement from @account at timestamp
[HUMINT - ASSESSED CREDIBLE] Reporter with track record reports
[HUMINT - CHATTER] Unverified reports (REQUIRES CORROBORATION)

Include:
- Source classification and confidence level
- Specific X accounts and timestamps
- Direct quotes when relevant
- Strategic implications

DISCLAIMER SECTION:
INTELLIGENCE DISCLAIMER:
- SIGINT (Verified): High confidence, official sources
- HUMINT (Assessed): Medium-high confidence, credible analysts  
- CHATTER (Unverified): Low confidence, requires corroboration

VALIDATION REQUIREMENTS:
- Ukraine-Russia conflict MUST be addressed
- Middle East situation MUST be covered
- All examples from {year}
- Minimum 3 SIGINT sources per section​​​​​​​​​​​​​​​​
